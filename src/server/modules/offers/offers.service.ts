// Offers — service (validation + totals + orchestration). Reference module.
//
// NOTE: the live route also resolves an optional work-folder link and notifies the
// customer when an offer is filed into a project. That orchestration is omitted from
// this reference cut and folded back in during adoption (src/lib/server/folder-link,
// notify-folder-update). Totals are computed server-side via the existing pure helper.

import { AppError } from '../../core/errors';
import { parseOfferItems, calculateOfferTotals } from '../../../lib/offer-totals';
import { CreateOfferScalarsSchema, ListOffersQuerySchema } from './offers.schema';
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

export async function listOffers(ctx: RepoContext, rawQuery: unknown): Promise<Offer[]> {
  const query = ListOffersQuerySchema.parse(rawQuery);
  const rows = await listOfferRows(ctx, query);
  const itemsMap = await fetchItemsForOffers(ctx, rows.map((r) => r.id));
  return rows.map((row) => dbToOffer(row, itemsMap[row.id] ?? []));
}

export async function createOffer(ctx: RepoContext, rawInput: unknown): Promise<Offer> {
  const input = CreateOfferScalarsSchema.parse(rawInput);
  const rawItems = (rawInput as Record<string, unknown>).items;

  const items = parseOfferItems(rawItems);
  if (!items) throw new AppError('invalid_items', 400);

  const vatRate = input.vatRate ?? 24;
  const customerId = input.customerId ?? null;
  const relatedTaskId = input.relatedTaskId ?? null;

  if (customerId && !(await customerExists(ctx, customerId))) {
    throw new AppError('customer_not_found', 404);
  }
  if (relatedTaskId && !(await taskExists(ctx, relatedTaskId))) {
    throw new AppError('task_not_found', 404);
  }

  const code = await loadOfferCode(ctx, customerId, null);
  const offerNumber = input.offerNumber ?? (await generateOfferNumber(ctx, code));
  const { subtotal, vatAmount, total, lineTotals } = calculateOfferTotals(items, vatRate);

  const offer = await insertOfferRow(ctx, {
    customer_id: customerId,
    related_task_id: relatedTaskId,
    related_call_id: input.relatedCallId ?? null,
    offer_number: offerNumber,
    status: input.status ?? 'draft',
    offer_date: input.offerDate ?? todayStr(),
    valid_until: input.validUntil ?? null,
    subtotal,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total,
    notes: input.notes ?? null,
    terms: input.terms ?? null,
    acceptance_text: input.acceptanceText ?? null,
    viber_draft: input.viberDraft ?? null,
    email_subject: input.emailSubject ?? null,
    email_body: input.emailBody ?? null,
    created_from_ai: input.createdFromAi === true,
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
    return dbToOffer(offer, itemRows);
  } catch (err) {
    // Clean up the orphaned offer, then surface the failure.
    await deleteOfferById(ctx, offer.id);
    throw err;
  }
}
