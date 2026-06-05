// Offers list and create endpoints (GET /api/offers, POST /api/offers).
// Phase 5: serves public.offers and public.offer_items from 007_offers_core.sql.
// Business isolation is enforced via explicit business_id filter on every query.
// (service_role bypasses RLS, so this filter is the sole isolation mechanism.)

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

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

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
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

interface ValidItem {
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder: number;
}

// Returns null if items array is missing, empty, or any item is invalid.
function parseItems(raw: unknown): ValidItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: ValidItem[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const r = item as Record<string, unknown>;
    const description = str(r.description);
    if (!description) return null;
    const quantity = optionalNumber(r.quantity);
    if (quantity === null || quantity <= 0) return null;
    const unitPrice = optionalNumber(r.unitPrice);
    if (unitPrice === null || unitPrice < 0) return null;
    const sortOrder = typeof r.sortOrder === 'number' ? Math.floor(r.sortOrder) : 0;
    items.push({ description, quantity, unitPrice, sortOrder });
  }
  return items;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calculateTotals(
  items: ValidItem[],
  vatRate: number
): { subtotal: number; vatAmount: number; total: number; lineTotals: number[] } {
  const lineTotals = items.map((item) => round2(item.quantity * item.unitPrice));
  const subtotal = round2(lineTotals.reduce((s, t) => s + t, 0));
  const vatAmount = round2((subtotal * vatRate) / 100);
  const total = round2(subtotal + vatAmount);
  return { subtotal, vatAmount, total, lineTotals };
}

// Generate the next OFFER-YYYY-N number for the business.
// The running number N is a single business-global sequence shared across ALL
// customers and ALL years: customer A getting OFFER-2026-15 means customer B's
// next offer is OFFER-2026-16. We derive N from the highest trailing number across
// every existing offer_number for the business (regardless of year prefix) + 1, so
// the sequence never resets. The current year is still used in the visible prefix.
// Race risk is acceptable at private beta scale, consistent with crm_number in customers API.
async function generateOfferNumber(
  supabase: SupabaseClient,
  businessId: string
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `OFFER-${year}-`;
  const { data } = await supabase
    .from('offers')
    .select('offer_number')
    .eq('business_id', businessId);
  let maxN = 0;
  for (const row of ((data ?? []) as unknown as { offer_number: string | null }[])) {
    const num = row.offer_number;
    if (!num) continue;
    // Take the trailing integer regardless of the prefix/year so the sequence is
    // a single global running counter for the whole business.
    const match = num.match(/(\d+)\s*$/);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (!isNaN(n) && n > maxN) maxN = n;
  }
  return `${prefix}${maxN + 1}`;
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

// Fetch items for a set of offer IDs in a single query and group by offer_id.
async function fetchItemsForOffers(
  supabase: SupabaseClient,
  businessId: string,
  offerIds: string[]
): Promise<Record<string, OfferItemRow[]>> {
  if (offerIds.length === 0) return {};
  const { data } = await supabase
    .from('offer_items')
    .select(ITEM_COLUMNS)
    .eq('business_id', businessId)
    .in('offer_id', offerIds)
    .order('sort_order', { ascending: true });
  const map: Record<string, OfferItemRow[]> = {};
  for (const row of ((data ?? []) as unknown[]).map(asOfferItemRow)) {
    if (!map[row.offer_id]) map[row.offer_id] = [];
    map[row.offer_id].push(row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// GET /api/offers
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { searchParams } = request.nextUrl;
    const statusParam = searchParams.get('status');
    const customerIdParam = searchParams.get('customerId');
    const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10);
    const offsetRaw = parseInt(searchParams.get('offset') ?? '0', 10);

    if (statusParam && !isValidEnum(statusParam, VALID_STATUSES)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
    }

    const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 100);
    const offset = Math.max(isNaN(offsetRaw) ? 0 : offsetRaw, 0);

    let query = supabase
      .from('offers')
      .select(OFFER_COLUMNS)
      .eq('business_id', businessId)
      .order('offer_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusParam) query = query.eq('status', statusParam);
    if (customerIdParam) query = query.eq('customer_id', customerIdParam);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: 'offers_query_failed' }, { status: 500 });
    }

    const offerRows = ((data ?? []) as unknown[]).map(asOfferRow);
    const itemsMap = await fetchItemsForOffers(
      supabase,
      businessId,
      offerRows.map((r) => r.id)
    );

    const offers = offerRows.map((row) => dbToOffer(row, itemsMap[row.id] ?? []));
    return NextResponse.json({ ok: true, offers, count: offers.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'offers_query_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/offers
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
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

    // items is required for POST
    const items = parseItems(raw.items);
    if (!items) {
      return NextResponse.json({ ok: false, error: 'invalid_items' }, { status: 400 });
    }

    // status defaults to draft
    if (raw.status != null && !isValidEnum(raw.status, VALID_STATUSES)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
    }
    const status = isValidEnum(raw.status, VALID_STATUSES) ? raw.status : 'draft';

    // vatRate defaults to 24
    const vatRate = raw.vatRate != null ? (optionalNumber(raw.vatRate) ?? 24) : 24;

    // offerDate defaults to today
    const offerDate = str(raw.offerDate) ?? todayStr();

    // validUntil may be null
    const validUntil = raw.validUntil != null ? str(raw.validUntil) : null;

    // customerId - validate ownership if provided
    const customerId = raw.customerId != null ? str(raw.customerId) : null;
    if (customerId) {
      const belongs = await validateCustomerBelongsToBusiness(supabase, customerId, businessId);
      if (!belongs) {
        return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
      }
    }

    // relatedTaskId - validate ownership if provided
    const relatedTaskId = raw.relatedTaskId != null ? str(raw.relatedTaskId) : null;
    if (relatedTaskId) {
      const belongs = await validateTaskBelongsToBusiness(supabase, relatedTaskId, businessId);
      if (!belongs) {
        return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 });
      }
    }

    // relatedCallId - bare uuid, no FK validation yet
    const relatedCallId = raw.relatedCallId != null ? str(raw.relatedCallId) : null;

    // offer number: use provided or generate
    const offerNumber =
      str(raw.offerNumber) ?? (await generateOfferNumber(supabase, businessId));

    // Compute totals server-side; client-supplied subtotal/vatAmount/total are ignored
    const { subtotal, vatAmount, total, lineTotals } = calculateTotals(items, vatRate);

    // Insert offer row
    const { data: offerData, error: offerError } = await supabase
      .from('offers')
      .insert({
        business_id: businessId,
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
      })
      .select(OFFER_COLUMNS)
      .single();

    if (offerError || !offerData) {
      return NextResponse.json({ ok: false, error: 'offer_create_failed' }, { status: 500 });
    }

    const offer = asOfferRow(offerData as unknown);

    // Insert items; if this fails, clean up the orphaned offer and return 500
    const { data: itemsData, error: itemsError } = await supabase
      .from('offer_items')
      .insert(
        items.map((item, idx) => ({
          business_id: businessId,
          offer_id: offer.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          line_total: lineTotals[idx],
          sort_order: item.sortOrder,
        }))
      )
      .select(ITEM_COLUMNS);

    if (itemsError || !itemsData) {
      // Best-effort cleanup so the DB is not left with an empty offer.
      await supabase
        .from('offers')
        .delete()
        .eq('id', offer.id)
        .eq('business_id', businessId);
      return NextResponse.json({ ok: false, error: 'offer_create_failed' }, { status: 500 });
    }

    const insertedItems = (itemsData as unknown[]).map(asOfferItemRow);
    return NextResponse.json(
      { ok: true, offer: dbToOffer(offer, insertedItems) },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ ok: false, error: 'offer_create_failed' }, { status: 500 });
  }
}
