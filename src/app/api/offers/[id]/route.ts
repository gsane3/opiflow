// Offer get-by-id and patch endpoints (GET /api/offers/[id], PATCH /api/offers/[id]).
// Phase 5: business isolation enforced via explicit business_id + id filter on every query.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { parseOfferItems, calculateOfferTotals, type ValidOfferItem } from '@/lib/offer-totals';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OFFER_COLUMNS = [
  'id', 'business_id', 'customer_id', 'related_task_id', 'related_call_id',
  'offer_number', 'status', 'offer_date', 'valid_until',
  'subtotal', 'vat_rate', 'vat_amount', 'total',
  'notes', 'terms', 'acceptance_text', 'viber_draft',
  'email_subject', 'email_body', 'created_from_ai',
  'created_at', 'updated_at',
].join(', ');

const ITEM_COLUMNS = [
  'id', 'business_id', 'offer_id', 'description', 'quantity',
  'unit_price', 'line_total', 'sort_order', 'created_at', 'updated_at',
].join(', ');

const VALID_STATUSES = [
  'draft', 'ready_to_send', 'sent_manually', 'accepted', 'rejected', 'expired',
] as const;

// ---------------------------------------------------------------------------
// Row interfaces
// ---------------------------------------------------------------------------

interface OfferRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  related_task_id: string | null;
  related_call_id: string | null;
  offer_number: string;
  status: string;
  offer_date: string;
  valid_until: string | null;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  acceptance_text: string | null;
  viber_draft: string | null;
  email_subject: string | null;
  email_body: string | null;
  created_from_ai: boolean;
  created_at: string;
  updated_at: string;
}

interface OfferItemRow {
  id: string;
  business_id: string;
  offer_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function asOfferRow(v: unknown): OfferRow { return v as OfferRow; }
function asOfferItemRow(v: unknown): OfferItemRow { return v as OfferItemRow; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

function isValidEnum<T extends string>(
  value: unknown,
  validValues: readonly T[]
): value is T {
  return typeof value === 'string' && (validValues as readonly string[]).includes(value);
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

async function validateCustomerBelongsToBusiness(
  supabase: SupabaseClient,
  customerId: string,
  businessId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();
  return data !== null;
}

async function validateTaskBelongsToBusiness(
  supabase: SupabaseClient,
  taskId: string,
  businessId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .eq('business_id', businessId)
    .maybeSingle();
  return data !== null;
}

function dbToOfferItem(row: OfferItemRow) {
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

function dbToOffer(row: OfferRow, items: OfferItemRow[]) {
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

async function fetchItemsForOffer(
  supabase: SupabaseClient,
  businessId: string,
  offerId: string
): Promise<OfferItemRow[]> {
  const { data } = await supabase
    .from('offer_items')
    .select(ITEM_COLUMNS)
    .eq('business_id', businessId)
    .eq('offer_id', offerId)
    .order('sort_order', { ascending: true });
  return ((data ?? []) as unknown[]).map(asOfferItemRow);
}

// ---------------------------------------------------------------------------
// GET /api/offers/[id]
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { id } = await params;

    const { data, error } = await supabase
      .from('offers')
      .select(OFFER_COLUMNS)
      .eq('id', id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'offer_query_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
    }

    const offer = asOfferRow(data as unknown);
    const items = await fetchItemsForOffer(supabase, businessId, id);
    return NextResponse.json({ ok: true, offer: dbToOffer(offer, items) });
  } catch {
    return NextResponse.json({ ok: false, error: 'offer_query_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/offers/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    // Fetch the current offer to verify ownership and get current vatRate.
    const { data: existingData, error: existingError } = await supabase
      .from('offers')
      .select(OFFER_COLUMNS)
      .eq('id', id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ ok: false, error: 'offer_update_failed' }, { status: 500 });
    }
    if (!existingData) {
      return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
    }

    const existing = asOfferRow(existingData as unknown);

    // Build the update fields object from whitelisted keys only.
    const updateFields: Record<string, unknown> = {};
    let hasUpdate = false;

    if ('status' in raw) {
      if (!isValidEnum(raw.status, VALID_STATUSES)) {
        return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
      }
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

    if ('notes' in raw) {
      updateFields.notes = str(raw.notes);
      hasUpdate = true;
    }

    if ('terms' in raw) {
      updateFields.terms = str(raw.terms);
      hasUpdate = true;
    }

    if ('acceptanceText' in raw) {
      updateFields.acceptance_text = str(raw.acceptanceText);
      hasUpdate = true;
    }

    if ('viberDraft' in raw) {
      updateFields.viber_draft = str(raw.viberDraft);
      hasUpdate = true;
    }

    if ('emailSubject' in raw) {
      updateFields.email_subject = str(raw.emailSubject);
      hasUpdate = true;
    }

    if ('emailBody' in raw) {
      updateFields.email_body = str(raw.emailBody);
      hasUpdate = true;
    }

    // customerId: null clears, string validates ownership
    if ('customerId' in raw) {
      if (raw.customerId === null) {
        updateFields.customer_id = null;
        hasUpdate = true;
      } else {
        const cId = str(raw.customerId);
        if (cId) {
          const belongs = await validateCustomerBelongsToBusiness(supabase, cId, businessId);
          if (!belongs) {
            return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
          }
          updateFields.customer_id = cId;
          hasUpdate = true;
        }
      }
    }

    // relatedTaskId: null clears, string validates ownership
    if ('relatedTaskId' in raw) {
      if (raw.relatedTaskId === null) {
        updateFields.related_task_id = null;
        hasUpdate = true;
      } else {
        const tId = str(raw.relatedTaskId);
        if (tId) {
          const belongs = await validateTaskBelongsToBusiness(supabase, tId, businessId);
          if (!belongs) {
            return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 });
          }
          updateFields.related_task_id = tId;
          hasUpdate = true;
        }
      }
    }

    if ('relatedCallId' in raw) {
      updateFields.related_call_id = raw.relatedCallId === null ? null : str(raw.relatedCallId);
      hasUpdate = true;
    }

    // ---------------------------------------------------------------------------
    // Items replacement and totals recomputation
    // ---------------------------------------------------------------------------
    // Rules:
    //   - If `items` is present: full replacement + recompute totals.
    //   - If only `vatRate` is present (no items): fetch existing items + recompute.
    //   - If neither: do not touch totals.
    // Client-supplied subtotal/vatAmount/total are always ignored.

    const hasNewItems = 'items' in raw;
    const hasNewVatRate = 'vatRate' in raw;
    let finalItems: OfferItemRow[] | null = null;

    if (hasNewItems) {
      const newItems = parseOfferItems(raw.items);
      if (!newItems) {
        return NextResponse.json({ ok: false, error: 'invalid_items' }, { status: 400 });
      }

      const vatRate =
        hasNewVatRate && raw.vatRate != null
          ? (optionalNumber(raw.vatRate) ?? existing.vat_rate)
          : existing.vat_rate;

      const { subtotal, vatAmount, total, lineTotals } = calculateOfferTotals(newItems, vatRate);

      // Delete all existing items for this offer (business_id is included for safety).
      const { error: deleteError } = await supabase
        .from('offer_items')
        .delete()
        .eq('offer_id', id)
        .eq('business_id', businessId);

      if (deleteError) {
        return NextResponse.json({ ok: false, error: 'offer_update_failed' }, { status: 500 });
      }

      // Insert replacement items.
      const { data: insertedData, error: insertError } = await supabase
        .from('offer_items')
        .insert(
          newItems.map((item, idx) => ({
            business_id: businessId,
            offer_id: id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            line_total: lineTotals[idx],
            sort_order: item.sortOrder,
          }))
        )
        .select(ITEM_COLUMNS);

      if (insertError || !insertedData) {
        return NextResponse.json({ ok: false, error: 'offer_update_failed' }, { status: 500 });
      }

      finalItems = (insertedData as unknown[]).map(asOfferItemRow);
      updateFields.subtotal = subtotal;
      updateFields.vat_rate = vatRate;
      updateFields.vat_amount = vatAmount;
      updateFields.total = total;
      hasUpdate = true;
    } else if (hasNewVatRate && raw.vatRate != null) {
      // vatRate changed but items were not replaced: fetch existing items and recompute.
      const newVatRate = optionalNumber(raw.vatRate);
      if (newVatRate !== null && newVatRate >= 0) {
        const currentItemRows = await fetchItemsForOffer(supabase, businessId, id);
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

    // If nothing changed, return the existing offer unchanged.
    if (!hasUpdate) {
      const items = await fetchItemsForOffer(supabase, businessId, id);
      return NextResponse.json({ ok: true, offer: dbToOffer(existing, items) });
    }

    updateFields.updated_at = new Date().toISOString();

    const { data: updatedData, error: updateError } = await supabase
      .from('offers')
      .update(updateFields)
      .eq('id', id)
      .eq('business_id', businessId)
      .select(OFFER_COLUMNS)
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ ok: false, error: 'offer_update_failed' }, { status: 500 });
    }
    if (!updatedData) {
      return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
    }

    const updatedOffer = asOfferRow(updatedData as unknown);

    // Use cached items from the replacement/recompute path if available.
    const responseItems =
      finalItems ?? (await fetchItemsForOffer(supabase, businessId, id));

    return NextResponse.json({ ok: true, offer: dbToOffer(updatedOffer, responseItems) });
  } catch {
    return NextResponse.json({ ok: false, error: 'offer_update_failed' }, { status: 500 });
  }
}
