// Offers — service (explicit validation + totals + orchestration). Parity-matched to /api/offers.
//
// Explicit validation emits the route's exact codes (invalid_items, invalid_status,
// invalid_vat_rate, customer_not_found, task_not_found) — not a generic Zod error — so
// the contract is unchanged. Totals come from the existing pure helper. The work-folder
// link + customer notification are injected by the route (DI), keeping this testable.

import { AppError } from '../../core/errors';
import { parseOfferItems, calculateOfferTotals } from '../../../lib/offer-totals';
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
  fetchItemsForOffers,
  generateOfferNumber,
  insertOfferItems,
  insertOfferRow,
  listOfferRows,
  loadOfferCode,
  taskExists,
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
