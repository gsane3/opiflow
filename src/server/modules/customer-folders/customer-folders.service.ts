// Customer Έργα (work folders) list/create — service (validation + orchestration).
// Parity-matched to /api/customers/[id]/folders (GET list + POST create).
//
// Each public function reproduces the live route's BROAD CATCH: the whole body is
// wrapped so any unexpected (non-AppError) throw becomes that route's single domain
// code (GET → folders_query_failed, POST → folder_create_failed) — never internal_error.
// Known failures are thrown as AppError(<exact original code>, <exact original status>)
// and rethrown as-is. The customer-ownership gate, the migration-047 double-select
// fallback, the best-effort per-folder count tally, the create validation order
// (title → status → customer) and every coercion (str() trim-or-null) are preserved,
// so the wire format is byte-identical.

import { AppError } from '../../core/errors';
import {
  APPOINTMENT_TASK_TYPES,
  dbToFolder,
  emptyFolderCounts,
  isFolderStatus,
  orderFolders,
  validateFolderTitle,
  type FolderCounts,
  type WorkFolder,
  type WorkFolderRow,
} from '../../../lib/server/work-folders';
import {
  customerBelongsToBusiness,
  fetchFolderCountSources,
  insertFolderRow,
  listFolderRowsWithFallback,
  type RepoContext,
} from './customer-folders.repo';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Rethrow AppError as-is; convert anything else to the given route's domain code. */
function rethrow(err: unknown, fallbackCode: string): never {
  if (err instanceof AppError) throw err;
  throw new AppError(fallbackCode, 500);
}

/**
 * Lightweight per-folder counts. One small query per entity table (selecting only
 * work_folder_id), tallied in JS — best-effort: a failing count query just leaves
 * that count at 0, never failing the whole list.
 */
async function loadFolderCounts(
  ctx: RepoContext,
  folderIds: string[],
): Promise<Map<string, FolderCounts>> {
  const map = new Map<string, FolderCounts>();
  for (const id of folderIds) map.set(id, emptyFolderCounts());
  if (folderIds.length === 0) return map;

  const tally = (
    rows: unknown[] | null | undefined,
    key: keyof FolderCounts,
    pred?: (row: Record<string, unknown>) => boolean,
  ) => {
    for (const r of rows ?? []) {
      const row = r as Record<string, unknown>;
      const fid = row.work_folder_id as string | null;
      if (!fid || !map.has(fid)) continue;
      if (pred && !pred(row)) continue;
      map.get(fid)![key] += 1;
    }
  };

  try {
    const { offersRes, tasksRes, commsRes, uploadRes, intakeRes } = await fetchFolderCountSources(ctx, folderIds);
    tally(offersRes.data as unknown[] | null, 'offers');
    tally(tasksRes.data as unknown[] | null, 'appointments', (row) =>
      (APPOINTMENT_TASK_TYPES as readonly string[]).includes(row.type as string),
    );
    tally(commsRes.data as unknown[] | null, 'messages');
    tally(uploadRes.data as unknown[] | null, 'uploadRequests');
    tally(intakeRes.data as unknown[] | null, 'intakeRequests');
  } catch {
    // best-effort — return whatever we have (zeros)
  }
  return map;
}

/**
 * GET /api/customers/[id]/folders — list this customer's folders (+ counts).
 * customer_not_found (404) when the customer is missing/other-tenant;
 * folders_query_failed (500) on a DB error or any unexpected throw.
 */
export async function listCustomerFolders(
  ctx: RepoContext,
  customerId: string,
): Promise<WorkFolder[]> {
  try {
    if (!(await customerBelongsToBusiness(ctx, customerId))) {
      throw new AppError('customer_not_found', 404);
    }

    const { data: rowData, error: queryError } = await listFolderRowsWithFallback(ctx, customerId);

    if (queryError) {
      throw new AppError('folders_query_failed', 500);
    }

    const rows = ((rowData ?? []) as unknown[]) as WorkFolderRow[];
    const countsByFolder = await loadFolderCounts(ctx, rows.map((r) => r.id));
    const folders = orderFolders(
      rows.map((r) => dbToFolder(r, countsByFolder.get(r.id) ?? emptyFolderCounts())),
    );

    return folders;
  } catch (err) {
    rethrow(err, 'folders_query_failed');
  }
}

/**
 * POST /api/customers/[id]/folders — create a folder for this customer.
 * Validation order matches the live route exactly: title → status → customer
 * existence. invalid_status (400) for a bad status, customer_not_found (404),
 * folder_create_failed (500) on a DB error or any unexpected throw.
 */
export async function createCustomerFolder(
  ctx: RepoContext,
  customerId: string,
  raw: Record<string, unknown>,
): Promise<WorkFolder> {
  try {
    const titleCheck = validateFolderTitle(raw.title);
    if (!titleCheck.ok) {
      throw new AppError(titleCheck.error, 400);
    }

    let status = 'open';
    if (raw.status != null) {
      if (!isFolderStatus(raw.status)) {
        throw new AppError('invalid_status', 400);
      }
      status = raw.status;
    }

    if (!(await customerBelongsToBusiness(ctx, customerId))) {
      throw new AppError('customer_not_found', 404);
    }

    const now = new Date().toISOString();
    const { data, error } = await insertFolderRow(ctx, customerId, {
      title: titleCheck.value,
      status,
      notes: str(raw.notes),
      updated_at: now,
    });

    if (error || !data) {
      throw new AppError('folder_create_failed', 500);
    }

    return dbToFolder(data as WorkFolderRow);
  } catch (err) {
    rethrow(err, 'folder_create_failed');
  }
}
