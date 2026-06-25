// Offers — service (explicit validation + totals + orchestration). Parity-matched to /api/offers.
//
// Explicit validation emits the route's exact codes (invalid_items, invalid_status,
// invalid_vat_rate, customer_not_found, task_not_found) — not a generic Zod error — so
// the contract is unchanged. Totals come from the existing pure helper. The work-folder
// link + customer notification are injected by the route (DI), keeping this testable.

import { AppError } from '../../core/errors';
import { parseOfferItems, calculateOfferTotals, type ValidOfferItem } from '../../../lib/offer-totals';
import { OFFER_STATUSES } from './offers.schema';
import {
  type Offer,
  type OfferItem,
  type OfferItemRow,
  type OfferRow,
} from './offers.types';
import {
  customerExists,
  deleteOfferById,
  deleteOfferResponseTokens,
  deleteOfferRowChecked,
  detachTasksFromOffer,
  fetchItemsForOffer,
  fetchItemsForOffers,
  fetchOfferRowForUpdate,
  findOfferExists,
  generateOfferNumber,
  getOfferRowById,
  insertOfferItems,
  insertOfferRow,
  listOfferRows,
  loadOfferCode,
  replaceOfferItems,
  taskExists,
  updateOfferRow,
  type RepoContext,
} from './offers.repo';

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
function optionalNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function isValidEnum<T extends string>(value: unknown, valid: readonly T[]): value is T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value);
}
function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export function dbToOfferItem(row: OfferItemRow): OfferItem {
  return {
    id: row.id,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function dbToOffer(row: OfferRow, items: OfferItemRow[]): Offer {
  return {
    id: row.id,
    customerId: row.customer_id,
    relatedTaskId: row.related_task_id,
    relatedCallId: row.related_call_id,
    offerNumber: row.offer_number,
    status: row.status,
    offerDate: row.offer_date,
    validUntil: row.valid_until,
    items: items.map(dbToOfferItem),
    subtotal: row.subtotal,
    vatRate: row.vat_rate,
    vatAmount: row.vat_amount,
    total: row.total,
    notes: row.notes,
    terms: row.terms,
    acceptanceText: row.acceptance_text,
    viberDraft: row.viber_draft,
    emailSubject: row.email_subject,
    emailBody: row.email_body,
    createdFromAi: row.created_from_ai,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListOffersInput {
  status?: string | null;
  customerId?: string | null;
  limit?: string | null;
  offset?: string | null;
}

export async function listOffers(ctx: RepoContext, input: ListOffersInput): Promise<Offer[]> {
  if (input.status && !isValidEnum(input.status, OFFER_STATUSES)) {
    throw new AppError('invalid_status', 400);
  }
  const limitRaw = parseInt(input.limit ?? '50', 10);
  const offsetRaw = parseInt(input.offset ?? '0', 10);
  const limit = Math.min(Math.max(Number.isNaN(limitRaw) ? 50 : limitRaw, 1), 100);
  const offset = Math.max(Number.isNaN(offsetRaw) ? 0 : offsetRaw, 0);

  const rows = await listOfferRows(ctx, {
    status: input.status ?? undefined,
    customerId: input.customerId ?? undefined,
    limit,
    offset,
  });
  const itemsMap = await fetchItemsForOffers(ctx, rows.map((r) => r.id));
  return rows.map((row) => dbToOffer(row, itemsMap[row.id] ?? []));
}

export type FolderResolution =
  | { ok: true; workFolderId: string | null }
  | { ok: false; error: string; status: number };

export interface CreateOfferDeps {
  resolveWorkFolder?: (rawWorkFolderId: unknown, customerId: string | null) => Promise<FolderResolution>;
  notifyFolderUpdate?: (workFolderId: string, what: string) => void;
}

export async function createOffer(
  ctx: RepoContext,
  raw: Record<string, unknown>,
  deps: CreateOfferDeps = {},
): Promise<Offer> {
  const items = parseOfferItems(raw.items);
  if (!items) throw new AppError('invalid_items', 400);

  if (raw.status != null && !isValidEnum(raw.status, OFFER_STATUSES)) {
    throw new AppError('invalid_status', 400);
  }
  const status = isValidEnum(raw.status, OFFER_STATUSES) ? raw.status : 'draft';

  const vatRate = raw.vatRate != null ? (optionalNumber(raw.vatRate) ?? 24) : 24;
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    throw new AppError('invalid_vat_rate', 400);
  }

  const offerDate = str(raw.offerDate) ?? todayStr();
  const validUntil = raw.validUntil != null ? str(raw.validUntil) : null;

  const customerId = raw.customerId != null ? str(raw.customerId) : null;
  if (customerId && !(await customerExists(ctx, customerId))) {
    throw new AppError('customer_not_found', 404);
  }
  const relatedTaskId = raw.relatedTaskId != null ? str(raw.relatedTaskId) : null;
  if (relatedTaskId && !(await taskExists(ctx, relatedTaskId))) {
    throw new AppError('task_not_found', 404);
  }
  const relatedCallId = raw.relatedCallId != null ? str(raw.relatedCallId) : null;

  let workFolderId: string | null = null;
  if (deps.resolveWorkFolder) {
    const fl = await deps.resolveWorkFolder(raw.workFolderId, customerId);
    if (!fl.ok) throw new AppError(fl.error, fl.status);
    workFolderId = fl.workFolderId;
  }

  const code = await loadOfferCode(ctx, customerId, workFolderId);
  const offerNumber = str(raw.offerNumber) ?? (await generateOfferNumber(ctx, code));
  const { subtotal, vatAmount, total, lineTotals } = calculateOfferTotals(items, vatRate);

  const offer = await insertOfferRow(ctx, {
    customer_id: customerId,
    related_task_id: relatedTaskId,
    related_call_id: relatedCallId,
    offer_number: offerNumber,
    status,
    offer_date: offerDate,
    valid_until: validUntil,
    subtotal,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total,
    notes: str(raw.notes),
    terms: str(raw.terms),
    acceptance_text: str(raw.acceptanceText),
    viber_draft: str(raw.viberDraft),
    email_subject: str(raw.emailSubject),
    email_body: str(raw.emailBody),
    created_from_ai: raw.createdFromAi === true,
    ...(workFolderId ? { work_folder_id: workFolderId } : {}),
  });

  try {
    const itemRows = await insertOfferItems(
      ctx,
      items.map((item, idx) => ({
        offer_id: offer.id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        line_total: lineTotals[idx],
        sort_order: item.sortOrder,
      })),
    );
    if (workFolderId) deps.notifyFolderUpdate?.(workFolderId, 'νέα προσφορά');
    return dbToOffer(offer, itemRows);
  } catch (err) {
    await deleteOfferById(ctx, offer.id);
    throw err;
  }
}

/** GET /api/offers/[id]. offer_query_failed (500) on DB error; offer_not_found (404) when missing. */
export async function getOffer(ctx: RepoContext, id: string): Promise<Offer> {
  const row = await getOfferRowById(ctx, id);
  if (!row) throw new AppError('offer_not_found', 404);
  const items = await fetchItemsForOffer(ctx, id);
  return dbToOffer(row, items);
}

/**
 * PATCH /api/offers/[id]. Whitelisted scalar updates + ownership checks (customer_not_found,
 * task_not_found), with the route's exact items/totals rules:
 *   - `items` present  → full item replacement + recompute (vatRate folded in if also present).
 *   - only `vatRate`   → recompute from the existing items.
 *   - neither          → totals untouched.
 * Client-supplied subtotal/vatAmount/total are always ignored. No allowed field → returns
 * the existing offer unchanged.
 */
export async function updateOffer(
  ctx: RepoContext,
  id: string,
  raw: Record<string, unknown>,
): Promise<Offer> {
  const existing = await fetchOfferRowForUpdate(ctx, id);
  if (!existing) throw new AppError('offer_not_found', 404);

  const updateFields: Record<string, unknown> = {};
  let hasUpdate = false;

  if ('status' in raw) {
    if (!isValidEnum(raw.status, OFFER_STATUSES)) throw new AppError('invalid_status', 400);
    updateFields.status = raw.status;
    hasUpdate = true;
  }
  if ('offerDate' in raw) {
    const v = str(raw.offerDate);
    if (v) { updateFields.offer_date = v; hasUpdate = true; }
  }
  if ('validUntil' in raw) {
    updateFields.valid_until = raw.validUntil === null ? null : str(raw.validUntil);
    hasUpdate = true;
  }
  if ('offerNumber' in raw) {
    const v = str(raw.offerNumber);
    if (v) { updateFields.offer_number = v; hasUpdate = true; }
  }
  if ('notes' in raw) { updateFields.notes = str(raw.notes); hasUpdate = true; }
  if ('terms' in raw) { updateFields.terms = str(raw.terms); hasUpdate = true; }
  if ('acceptanceText' in raw) { updateFields.acceptance_text = str(raw.acceptanceText); hasUpdate = true; }
  if ('viberDraft' in raw) { updateFields.viber_draft = str(raw.viberDraft); hasUpdate = true; }
  if ('emailSubject' in raw) { updateFields.email_subject = str(raw.emailSubject); hasUpdate = true; }
  if ('emailBody' in raw) { updateFields.email_body = str(raw.emailBody); hasUpdate = true; }

  if ('customerId' in raw) {
    if (raw.customerId === null) {
      updateFields.customer_id = null;
      hasUpdate = true;
    } else {
      const cId = str(raw.customerId);
      if (cId) {
        if (!(await customerExists(ctx, cId))) throw new AppError('customer_not_found', 404);
        updateFields.customer_id = cId;
        hasUpdate = true;
      }
    }
  }
  if ('relatedTaskId' in raw) {
    if (raw.relatedTaskId === null) {
      updateFields.related_task_id = null;
      hasUpdate = true;
    } else {
      const tId = str(raw.relatedTaskId);
      if (tId) {
        if (!(await taskExists(ctx, tId))) throw new AppError('task_not_found', 404);
        updateFields.related_task_id = tId;
        hasUpdate = true;
      }
    }
  }
  if ('relatedCallId' in raw) {
    updateFields.related_call_id = raw.relatedCallId === null ? null : str(raw.relatedCallId);
    hasUpdate = true;
  }

  // ---- items replacement + totals recomputation ----
  const hasNewItems = 'items' in raw;
  const hasNewVatRate = 'vatRate' in raw;
  let finalItems: OfferItemRow[] | null = null;

  if (hasNewItems) {
    const newItems = parseOfferItems(raw.items);
    if (!newItems) throw new AppError('invalid_items', 400);

    const vatRate =
      hasNewVatRate && raw.vatRate != null
        ? (optionalNumber(raw.vatRate) ?? existing.vat_rate)
        : existing.vat_rate;
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      throw new AppError('invalid_vat_rate', 400);
    }

    const { subtotal, vatAmount, total, lineTotals } = calculateOfferTotals(newItems, vatRate);
    finalItems = await replaceOfferItems(
      ctx,
      id,
      newItems.map((item, idx) => ({
        offer_id: id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        line_total: lineTotals[idx],
        sort_order: item.sortOrder,
      })),
    );
    updateFields.subtotal = subtotal;
    updateFields.vat_rate = vatRate;
    updateFields.vat_amount = vatAmount;
    updateFields.total = total;
    hasUpdate = true;
  } else if (hasNewVatRate && raw.vatRate != null) {
    const newVatRate = optionalNumber(raw.vatRate);
    if (newVatRate !== null && newVatRate >= 0) {
      const currentItemRows = await fetchItemsForOffer(ctx, id);
      const currentItems: ValidOfferItem[] = currentItemRows.map((r) => ({
        description: r.description,
        quantity: r.quantity,
        unitPrice: r.unit_price,
        sortOrder: r.sort_order,
      }));
      const { subtotal, vatAmount, total } = calculateOfferTotals(currentItems, newVatRate);
      updateFields.vat_rate = newVatRate;
      updateFields.subtotal = subtotal;
      updateFields.vat_amount = vatAmount;
      updateFields.total = total;
      hasUpdate = true;
      finalItems = currentItemRows;
    }
  }

  if (!hasUpdate) {
    const items = await fetchItemsForOffer(ctx, id);
    return dbToOffer(existing, items);
  }

  updateFields.updated_at = new Date().toISOString();
  const updated = await updateOfferRow(ctx, id, updateFields);
  if (!updated) throw new AppError('offer_not_found', 404);

  const responseItems = finalItems ?? (await fetchItemsForOffer(ctx, id));
  return dbToOffer(updated, responseItems);
}

/**
 * DELETE /api/offers/[id]. Clears FK dependents first (response tokens via the service
 * client, then detaches tasks), both best-effort, then removes the offer.
 * offer_not_found (404) for a missing id; offer_delete_failed (500) on DB error.
 */
export async function deleteOffer(ctx: RepoContext, id: string): Promise<void> {
  const exists = await findOfferExists(ctx, id);
  if (!exists) throw new AppError('offer_not_found', 404);

  try {
    await deleteOfferResponseTokens(ctx.businessId, id);
  } catch {
    // non-fatal: the offer delete below may still succeed if there's no FK
  }
  try {
    await detachTasksFromOffer(ctx, id);
  } catch {
    // non-fatal
  }

  await deleteOfferRowChecked(ctx, id);
}
