// Έργο (work folder) detail / PATCH / DELETE / attach / attachable — service.
// Parity-matched to /api/folders/[id], /api/folders/[id]/attach,
// /api/folders/[id]/attachable.
//
// Each public function reproduces the live route's BROAD CATCH: the whole body is
// wrapped so any unexpected (non-AppError) throw becomes that route's single domain
// code (folder_detail_failed / folder_update_failed / folder_delete_failed /
// attach_failed / attachable_failed) — never internal_error. Known failures are
// thrown as AppError(<exact original code>, <exact original status>) and rethrown
// as-is. Validation, the migration-047 double-select, the migration-tolerant
// read-receipt merge, the no-change "return current folder" path and the terminal-
// transition token cap are all preserved, so the wire format is byte-identical.

import { AppError } from '../../core/errors';
import type { TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  APPOINTMENT_TASK_TYPES,
  ATTACHABLE_ENTITIES,
  dbToFolder,
  isAttachableEntityType,
  isFolderStatus,
  isTerminalFolderStatus,
  validateFolderStep,
  validateFolderTitle,
  type FolderCounts,
  type WorkFolder,
  type WorkFolderRow,
} from '../../../lib/server/work-folders';
import {
  capFolderTokensExpiry,
  FOLDER_TOKEN_EXPIRY_HOURS,
} from '../../../lib/server/folder-tokens';
import {
  applyAttach,
  countLandedPayments,
  deleteFolder,
  fetchAttachableSources,
  fetchEntityForAttach,
  fetchFolderCustomer,
  fetchFolderDetailSources,
  fetchFolderForAttach,
  fetchFolderForNoUpdate,
  fetchFolderId,
  fetchFolderStatus,
  fetchFolderWithFallback,
  fetchReadReceipts,
  updateFolderWithFallback,
  type RepoContext,
} from './folders.repo';

type Ctx = TenantContext & { supabase: ReturnType<typeof createServerSupabaseClient> };

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Rethrow AppError as-is; convert anything else to the route's single domain code. */
function broad(err: unknown, code: string, status: number): never {
  if (err instanceof AppError) throw err;
  throw new AppError(code, status);
}

// ---------------------------------------------------------------------------
// GET /api/folders/[id] — folder detail with per-section counts + latest items.
// ---------------------------------------------------------------------------

export interface FolderDetailResult {
  folder: WorkFolder;
  customer:
    | { id: string; name: string | null; phone: string | null; email: string | null; hasDetails: boolean }
    | null;
  sections: {
    offers: { count: number; items: unknown[] };
    appointments: { count: number; items: unknown[] };
    messages: { count: number; items: unknown[] };
    photos: { count: number; items: unknown[] };
    intake: { count: number; items: unknown[] };
  };
}

export async function getFolderDetail(
  ctx: Ctx,
  folderId: string,
): Promise<FolderDetailResult> {
  try {
    const { data: folderData, error: folderErr } = await fetchFolderWithFallback(
      ctx as RepoContext,
      folderId,
    );
    if (folderErr) throw new AppError('folder_detail_failed', 500);
    if (!folderData) throw new AppError('folder_not_found', 404);
    const folderRow = folderData as unknown as WorkFolderRow;

    const { custRes, offersRes, apptRes, msgRes, photoRes, intakeRes } =
      await fetchFolderDetailSources(
        ctx as RepoContext,
        folderId,
        folderRow.customer_id,
        APPOINTMENT_TASK_TYPES,
      );

    const counts: FolderCounts = {
      offers: offersRes.count ?? 0,
      appointments: apptRes.count ?? 0,
      messages: msgRes.count ?? 0,
      uploadRequests: photoRes.count ?? 0,
      intakeRequests: intakeRes.count ?? 0,
    };

    const cust = custRes.data as
      | { id: string; name: string | null; company_name: string | null; crm_number: string | null; phone: string | null; mobile_phone: string | null; email: string | null; address: string | null; vat_number: string | null; intake_status: string | null }
      | null;
    // #5: does the customer already have their details? Drives «Ζήτα στοιχεία» vs
    // «Επικαιροποίηση στοιχείων». True if they submitted intake, or already have a
    // real name plus an address/email/ΑΦΜ on file.
    const hasDetails = !!cust && (
      cust.intake_status === 'submitted' ||
      (!!cust.name?.trim() && (!!cust.address?.trim() || !!cust.email?.trim() || !!cust.vat_number?.trim()))
    );
    const customer = cust
      ? {
          id: cust.id,
          name: cust.name ?? cust.company_name ?? cust.crm_number ?? null,
          phone: cust.phone ?? cust.mobile_phone ?? null,
          email: cust.email,
          hasDetails,
        }
      : null;

    const offers = ((offersRes.data ?? []) as unknown[]).map((r) => {
      const o = r as { id: string; offer_number: string | null; status: string; total: number | null; created_at: string };
      return { id: o.id, offerNumber: o.offer_number, status: o.status, total: o.total, createdAt: o.created_at };
    });
    const appointments = ((apptRes.data ?? []) as unknown[]).map((r) => {
      const t = r as { id: string; title: string; type: string; status: string; due_date: string | null; due_time: string | null };
      return { id: t.id, title: t.title, type: t.type, status: t.status, dueDate: t.due_date, dueTime: t.due_time };
    });
    const messages = ((msgRes.data ?? []) as unknown[]).map((r) => {
      const m = r as { id: string; summary: string | null; direction: string; channel: string; created_at: string };
      return { id: m.id, summary: m.summary, direction: m.direction, channel: m.channel, createdAt: m.created_at, readAt: null as string | null };
    });

    // Read receipts (migration 057): tolerant merge so a pre-057 schema simply
    // shows no «Διαβάστηκε». Kept out of the parallel query above so a missing
    // read_at column can never break the core folder-detail fetch.
    try {
      const msgIds = messages.map((m) => m.id);
      if (msgIds.length > 0) {
        const { data: reads, error: readErr } = await fetchReadReceipts(ctx as RepoContext, msgIds);
        if (!readErr && Array.isArray(reads)) {
          const readMap = new Map(
            (reads as Array<{ id: string; read_at: string | null }>).map((r) => [r.id, r.read_at]),
          );
          for (const m of messages) m.readAt = readMap.get(m.id) ?? null;
        }
      }
    } catch {
      // pre-057 → no read receipts
    }
    // NB: token_hash is never selected → never exposed.
    const photos = ((photoRes.data ?? []) as unknown[]).map((r) => {
      const u = r as { id: string; status: string; sent_channel: string | null; created_at: string; opened_at: string | null; completed_at: string | null };
      return { id: u.id, status: u.status, sentChannel: u.sent_channel, createdAt: u.created_at, openedAt: u.opened_at, completedAt: u.completed_at };
    });
    const intake = ((intakeRes.data ?? []) as unknown[]).map((r) => {
      const i = r as { id: string; status: string; sent_channel: string | null; created_at: string; opened_at: string | null; submitted_at: string | null };
      return { id: i.id, status: i.status, sentChannel: i.sent_channel, createdAt: i.created_at, openedAt: i.opened_at, submittedAt: i.submitted_at };
    });

    return {
      folder: dbToFolder(folderRow, counts),
      customer,
      sections: {
        offers: { count: counts.offers, items: offers },
        appointments: { count: counts.appointments, items: appointments },
        messages: { count: counts.messages, items: messages },
        photos: { count: counts.uploadRequests, items: photos },
        intake: { count: counts.intakeRequests, items: intake },
      },
    };
  } catch (err) {
    broad(err, 'folder_detail_failed', 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/folders/[id] — update title / status / step / notes.
// ---------------------------------------------------------------------------

export async function patchFolder(
  ctx: Ctx,
  folderId: string,
  raw: Record<string, unknown>,
): Promise<{ folder: WorkFolder }> {
  try {
    // Validate any provided fields up front.
    let title: string | undefined;
    if ('title' in raw) {
      const titleCheck = validateFolderTitle(raw.title);
      if (!titleCheck.ok) throw new AppError(titleCheck.error, 400);
      title = titleCheck.value;
    }
    if (raw.status != null && !isFolderStatus(raw.status)) {
      throw new AppError('invalid_status', 400);
    }
    let step: number | undefined;
    if ('step' in raw) {
      const stepCheck = validateFolderStep(raw.step);
      if (!stepCheck.ok) throw new AppError(stepCheck.error, 400);
      step = stepCheck.value;
    }

    const updateFields: Record<string, unknown> = {};
    let hasUpdate = false;
    if (title !== undefined) { updateFields.title = title; hasUpdate = true; }
    if ('status' in raw && isFolderStatus(raw.status)) { updateFields.status = raw.status; hasUpdate = true; }
    if (step !== undefined) { updateFields.step = step; hasUpdate = true; }
    if ('notes' in raw) { updateFields.notes = str(raw.notes); hasUpdate = true; }

    // Nothing to change → return the current folder (business-scoped).
    if (!hasUpdate) {
      const { data: curData, error: curErr } = await fetchFolderForNoUpdate(ctx as RepoContext, folderId);
      if (curErr) throw new AppError('folder_update_failed', 500);
      if (!curData) throw new AppError('folder_not_found', 404);
      return { folder: dbToFolder(curData as WorkFolderRow) };
    }

    updateFields.updated_at = new Date().toISOString();

    // Detect a real transition INTO a terminal status (done/archived) so the
    // post-completion countdown for the customer link starts exactly once — not on
    // every later edit that re-sends the same status.
    const becomingTerminal = 'status' in raw && isTerminalFolderStatus(raw.status);
    let wasTerminal = false;
    if (becomingTerminal) {
      const prev = await fetchFolderStatus(ctx as RepoContext, folderId);
      wasTerminal = isTerminalFolderStatus(prev.data?.status);
    }

    const { data: updData, error: updErr } = await updateFolderWithFallback(
      ctx as RepoContext,
      folderId,
      updateFields,
    );

    if (updErr) throw new AppError('folder_update_failed', 500);
    if (!updData) throw new AppError('folder_not_found', 404);

    // On a real transition INTO a terminal status (done/archived), start the
    // post-completion countdown: the customer's live links close 30 days later.
    // Gated on the transition so unrelated edits to an already-terminal folder
    // don't reset the clock. Best-effort — never blocks the response.
    if (becomingTerminal && !wasTerminal) {
      try {
        await capFolderTokensExpiry({ businessId: ctx.businessId, workFolderId: folderId, hours: FOLDER_TOKEN_EXPIRY_HOURS });
      } catch { /* best-effort */ }
    }

    return { folder: dbToFolder(updData as WorkFolderRow) };
  } catch (err) {
    broad(err, 'folder_update_failed', 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/folders/[id] — permanently delete one Έργο (work folder).
// ---------------------------------------------------------------------------

export async function removeFolder(ctx: Ctx, folderId: string): Promise<void> {
  try {
    // Confirm it exists AND belongs to this business, so we 404 instead of
    // silently succeeding on a missing folder or one owned by someone else.
    const { data: existing, error: findErr } = await fetchFolderId(ctx as RepoContext, folderId);
    if (findErr) throw new AppError('folder_delete_failed', 500);
    if (!existing) throw new AppError('folder_not_found', 404);

    // Guard money-landed payments: payment_requests.work_folder_id is ON DELETE
    // SET NULL, so deleting a folder with declared/confirmed deposits would orphan
    // those financial records. Block it (the owner can cancel the payment first).
    // Best-effort: if the table query errors (e.g. pre-048), fall through and allow.
    const paidCount = await countLandedPayments(ctx as RepoContext, folderId);
    if ((paidCount ?? 0) > 0) {
      throw new AppError('folder_has_payments', 409);
    }

    const { error: delErr } = await deleteFolder(ctx as RepoContext, folderId);
    if (delErr) throw new AppError('folder_delete_failed', 500);
  } catch (err) {
    broad(err, 'folder_delete_failed', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/folders/[id]/attach — file an existing record into a folder (or remove).
// ---------------------------------------------------------------------------

export interface AttachResult {
  entityType: string;
  entityId: string;
  attached: boolean;
  workFolderId: string | null;
}

export async function attachEntity(
  ctx: Ctx,
  folderId: string,
  raw: Record<string, unknown>,
): Promise<AttachResult> {
  try {
    if (!isAttachableEntityType(raw.entityType)) {
      throw new AppError('invalid_entity_type', 400);
    }
    const entityId = str(raw.entityId);
    if (!entityId) {
      throw new AppError('invalid_entity_id', 400);
    }
    if (typeof raw.attach !== 'boolean') {
      throw new AppError('invalid_attach', 400);
    }
    const attach = raw.attach;
    const table = ATTACHABLE_ENTITIES[raw.entityType];

    // 1) Folder must exist AND belong to the authenticated business.
    const { data: folder, error: folderErr } = await fetchFolderForAttach(ctx as RepoContext, folderId);
    if (folderErr) throw new AppError('attach_failed', 500);
    if (!folder) throw new AppError('folder_not_found', 404);
    const folderCustomerId = folder.customer_id;

    // 2) Entity must exist AND belong to the same business (business_id filter →
    //    a cross-business entity resolves as not found).
    const { data: entity, error: entityErr } = await fetchEntityForAttach(ctx as RepoContext, table, entityId);
    if (entityErr) throw new AppError('attach_failed', 500);
    if (!entity) throw new AppError('entity_not_found', 404);

    // 3) When attaching, the entity must belong to the SAME customer as the
    //    folder (a null/different customer_id is a mismatch).
    if (attach && entity.customer_id !== folderCustomerId) {
      throw new AppError('customer_mismatch', 409);
    }

    // 4) Apply. Re-assert the filters on the UPDATE itself (defense in depth);
    //    on attach also pin customer_id so a race can't file a wrong-customer row.
    const { error: updateErr } = await applyAttach(
      ctx as RepoContext,
      table,
      entityId,
      attach ? folderId : null,
      attach,
      folderCustomerId,
    );
    if (updateErr) throw new AppError('attach_failed', 500);

    return {
      entityType: raw.entityType,
      entityId,
      attached: attach,
      workFolderId: attach ? folderId : null,
    };
  } catch (err) {
    broad(err, 'attach_failed', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/folders/[id]/attachable — list UNFILED items attachable to this folder.
// ---------------------------------------------------------------------------

const PICK_LIMIT = 50;

export interface AttachableResult {
  offers: unknown[];
  appointments: unknown[];
  messages: unknown[];
  intake: unknown[];
  upload: unknown[];
}

export async function listAttachable(ctx: Ctx, folderId: string): Promise<AttachableResult> {
  try {
    // Folder must exist AND belong to the authenticated business.
    const { data: folder, error: folderErr } = await fetchFolderCustomer(ctx as RepoContext, folderId);
    if (folderErr) throw new AppError('attachable_failed', 500);
    if (!folder) throw new AppError('folder_not_found', 404);
    const customerId = folder.customer_id;

    // Communications/intake/upload pickers are noisier, so cap them tighter.
    const REQ_LIMIT = 20;

    const { offersRes, apptRes, msgRes, intakeRes, uploadRes } = await fetchAttachableSources(
      ctx as RepoContext,
      customerId,
      APPOINTMENT_TASK_TYPES,
      PICK_LIMIT,
      REQ_LIMIT,
    );

    if (offersRes.error || apptRes.error || msgRes.error || intakeRes.error || uploadRes.error) {
      throw new AppError('attachable_failed', 500);
    }

    const offers = ((offersRes.data ?? []) as unknown[]).map((r) => {
      const o = r as { id: string; offer_number: string | null; status: string; total: number | null };
      return { id: o.id, offerNumber: o.offer_number, status: o.status, total: o.total };
    });
    const appointments = ((apptRes.data ?? []) as unknown[]).map((r) => {
      const t = r as { id: string; title: string; type: string; status: string; due_date: string | null; due_time: string | null };
      return { id: t.id, title: t.title, type: t.type, status: t.status, dueDate: t.due_date, dueTime: t.due_time };
    });
    const messages = ((msgRes.data ?? []) as unknown[]).map((r) => {
      const m = r as { id: string; direction: string; channel: string; summary: string | null; created_at: string };
      return { id: m.id, direction: m.direction, channel: m.channel, summary: m.summary, createdAt: m.created_at };
    });
    // token_hash is never selected → never exposed.
    const intake = ((intakeRes.data ?? []) as unknown[]).map((r) => {
      const i = r as { id: string; status: string; sent_channel: string | null; created_at: string };
      return { id: i.id, status: i.status, sentChannel: i.sent_channel, createdAt: i.created_at };
    });
    const upload = ((uploadRes.data ?? []) as unknown[]).map((r) => {
      const u = r as { id: string; status: string; sent_channel: string | null; created_at: string };
      return { id: u.id, status: u.status, sentChannel: u.sent_channel, createdAt: u.created_at };
    });

    return { offers, appointments, messages, intake, upload };
  } catch (err) {
    broad(err, 'attachable_failed', 500);
  }
}
