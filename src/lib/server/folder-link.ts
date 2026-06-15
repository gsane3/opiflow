// Optional workFolderId support for create endpoints (WF-4).
//
// When a record (offer / task / …) is created from INSIDE a folder, the client
// passes `workFolderId`. Before filing the new row into that folder we verify
// the folder belongs to the SAME business AND the SAME customer as the new row —
// never trusting the folderId from the client. The field stays OPTIONAL, so all
// existing create flows (no workFolderId) are completely unchanged. Requires
// migration 046 (work_folders + the entity work_folder_id columns).

import type { createServerSupabaseClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerSupabaseClient>;

/** Read a clean non-empty workFolderId string, or null when absent. */
export function readWorkFolderId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type FolderForCreate =
  | { ok: true; workFolderId: string | null }
  | { ok: false; error: 'folder_not_found'; status: 404 }
  | { ok: false; error: 'customer_mismatch'; status: 409 };

/**
 * Resolve + authorize an optional workFolderId for a create.
 *   - absent/empty            → { ok: true, workFolderId: null } (unfiled — normal flow)
 *   - folder of another biz   → folder_not_found (404) — business_id filter hides it
 *   - folder of a different
 *     customer than the row   → customer_mismatch (409)
 *   - valid + same customer   → { ok: true, workFolderId }
 * Throws on an unexpected DB error so the caller returns its generic 500.
 */
export async function resolveWorkFolderForCreate(
  supabase: Db,
  businessId: string,
  rawWorkFolderId: unknown,
  entityCustomerId: string | null,
): Promise<FolderForCreate> {
  const workFolderId = readWorkFolderId(rawWorkFolderId);
  if (!workFolderId) return { ok: true, workFolderId: null };

  const { data, error } = await supabase
    .from('work_folders')
    .select('customer_id')
    .eq('id', workFolderId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw new Error('work_folder lookup failed');
  if (!data) return { ok: false, error: 'folder_not_found', status: 404 };

  const folderCustomerId = (data as { customer_id: string }).customer_id;
  if (!entityCustomerId || folderCustomerId !== entityCustomerId) {
    return { ok: false, error: 'customer_mismatch', status: 409 };
  }
  return { ok: true, workFolderId };
}
