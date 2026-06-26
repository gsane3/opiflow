// Folder-actions — service (explicit validation + orchestration). Parity-matched
// to the four /api/folders/[id] sub-routes:
//   - next-action  (GET compute-tolerant / PATCH lifecycle)
//   - attention    (GET compute-tolerant)
//   - payment-request (POST create)
//   - payment-requests (GET list)
//
// next-action + attention reuse the existing src/lib/server stores verbatim and
// stay tolerant (any compute throw → null), exactly like the live routes.
//
// payment-request preserves the live route's single body-level broad-catch:
// every known failure throws AppError(<exact code>,<status>) (invalid_kind 400 /
// invalid_pct 400 / offer_required 400 / folder_not_found 404 / offer_not_found 404 /
// bank_not_configured 400 / payment_request_failed 500), and ANY other unexpected
// throw collapses to payment_request_failed (500) — rethrowing AppError as-is.
// The customer notification (notifyFolderUpdate) is an external effect: it's
// injected by the route and fired fire-and-forget after the row is created.
//
// payment-requests degrades a query error (pre-048 table absent) to an empty list
// and never 500s; folder_not_found (404) is the only error it surfaces.

import { AppError } from '../../core/errors';
import type { TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  computeFolderNextAction,
  applyNextActionLifecycle,
  isNextActionLifecycle,
} from '../../../lib/server/next-action-store';
import { computeFolderAttentionForFolder } from '../../../lib/server/folder-attention-store';
import {
  computePaymentAmount,
  isPaymentKind,
  validatePct,
  mapBusinessPayment,
  type BusinessPayment,
  type PaymentRequestRow,
} from '../../../lib/server/payments';
import {
  fetchFolderForPayment,
  fetchOfferForPayment,
  fetchBusinessBank,
  insertPaymentRequest,
  fetchFolderId,
  listPaymentRequests,
  type RepoContext,
} from './folder-actions.repo';

type Ctx = TenantContext & { supabase: ReturnType<typeof createServerSupabaseClient> };

// ---------------------------------------------------------------------------
// next-action
// ---------------------------------------------------------------------------

/** GET — the computed folder next action, or null (tolerant of a pending migration 054). */
export async function getFolderNextAction(ctx: Ctx, folderId: string): Promise<unknown> {
  try {
    return await computeFolderNextAction(ctx.supabase, ctx.businessId, folderId);
  } catch {
    return null;
  }
}

/** PATCH — mark the active action accepted/dismissed/snoozed/completed. invalid_body (400). Returns res.ok. */
export async function applyFolderNextAction(ctx: Ctx, raw: Record<string, unknown>): Promise<boolean> {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const action = isNextActionLifecycle(raw.action) ? raw.action : null;
  if (!id || !action) throw new AppError('invalid_body', 400);
  const snoozeMinutes = typeof raw.snoozeMinutes === 'number' ? raw.snoozeMinutes : undefined;
  const res = await applyNextActionLifecycle(ctx.supabase, { businessId: ctx.businessId, id, action, snoozeMinutes });
  return res.ok;
}

// ---------------------------------------------------------------------------
// attention
// ---------------------------------------------------------------------------

/** GET — the folder's single attention state, or null (tolerant; never breaks the folder view). */
export async function getFolderAttention(ctx: Ctx, folderId: string): Promise<unknown> {
  try {
    return await computeFolderAttentionForFolder(ctx.supabase, ctx.businessId, folderId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// payment-request (create)
// ---------------------------------------------------------------------------

export interface CreatePaymentRequestDeps {
  /** Notify the customer about the new payment request (fire-and-forget, injected by the route). */
  notifyFolderUpdate?: (workFolderId: string, what: string) => void;
}

/**
 * Create a bank-transfer payment request for a folder. The amount is computed
 * SERVER-SIDE from the offer gross; the IBAN is snapshotted from the business
 * bank details. Body-level broad-catch parity: known codes throw AppError; any
 * other throw collapses to payment_request_failed (500).
 */
export async function createFolderPaymentRequest(
  ctx: RepoContext,
  folderId: string,
  raw: Record<string, unknown>,
  deps: CreatePaymentRequestDeps = {},
): Promise<BusinessPayment> {
  try {
    if (!isPaymentKind(raw.kind)) {
      throw new AppError('invalid_kind', 400);
    }
    const kind = raw.kind;
    const pctCheck = validatePct(raw.pct);
    if (!pctCheck.ok) {
      throw new AppError(pctCheck.error, 400);
    }
    const pct = pctCheck.value;
    if (typeof raw.offerId !== 'string' || raw.offerId.trim().length === 0) {
      throw new AppError('offer_required', 400);
    }
    const offerId = raw.offerId;

    // Folder must exist + belong to this business (→ customer_id).
    const { data: folder, error: folderErr } = await fetchFolderForPayment(ctx, folderId);
    if (folderErr) throw new AppError('payment_request_failed', 500);
    if (!folder) throw new AppError('folder_not_found', 404);

    // Offer must be in THIS folder + business (the gross source).
    const { data: offer, error: offerErr } = await fetchOfferForPayment(ctx, folderId, offerId);
    if (offerErr) throw new AppError('payment_request_failed', 500);
    if (!offer) throw new AppError('offer_not_found', 404);

    // Snapshot the business IBAN (requires migration 048). No IBAN → can't request.
    const { data: biz, error: bizErr } = await fetchBusinessBank(ctx, ctx.businessId);
    if (bizErr) throw new AppError('payment_request_failed', 500);
    const iban = biz?.bank_iban?.trim() || null;
    if (!iban) {
      throw new AppError('bank_not_configured', 400);
    }

    const amount = computePaymentAmount(typeof offer.total === 'number' ? offer.total : 0, pct);
    const now = new Date().toISOString();

    const { data: inserted, error: insErr } = await insertPaymentRequest(ctx, {
      customer_id: folder.customer_id,
      work_folder_id: folderId,
      offer_id: offer.id,
      kind,
      pct,
      amount,
      currency: 'EUR',
      status: 'pending',
      receiving_account: iban,
      updated_at: now,
    });

    if (insErr || !inserted) {
      throw new AppError('payment_request_failed', 500);
    }

    // γ — auto-notify the customer about the new payment request.
    deps.notifyFolderUpdate?.(folderId, kind === 'deposit' ? 'αίτημα προκαταβολής' : 'αίτημα εξόφλησης');
    return mapBusinessPayment(inserted as unknown as PaymentRequestRow);
  } catch (err) {
    // Broad-catch parity: rethrow known AppErrors; collapse anything else to the
    // route's single body-level code.
    if (err instanceof AppError) throw err;
    throw new AppError('payment_request_failed', 500);
  }
}

// ---------------------------------------------------------------------------
// payment-requests (list)
// ---------------------------------------------------------------------------

/**
 * List a folder's payment requests. folder_not_found (404) when the folder isn't
 * this tenant's; any other failure (incl. pre-048 table absent) degrades to an
 * empty list, never 500.
 */
export async function listFolderPaymentRequests(
  ctx: RepoContext,
  folderId: string,
): Promise<{ folderNotFound: boolean; payments: BusinessPayment[] }> {
  // Folder must belong to this business (work_folders exists since migration 046).
  const { data: folderData, error: folderErr } = await fetchFolderId(ctx, folderId);
  if (folderErr) return { folderNotFound: false, payments: [] };
  if (!folderData) return { folderNotFound: true, payments: [] };

  const { data, error } = await listPaymentRequests(ctx, folderId);
  if (error) {
    // Most likely pre-048 (table absent) — degrade to empty, never 500.
    return { folderNotFound: false, payments: [] };
  }

  const payments = ((data as PaymentRequestRow[] | null) ?? []).map(mapBusinessPayment);
  return { folderNotFound: false, payments };
}
