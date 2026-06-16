// Public offer-response API. No authenticated Bearer is required.
// The raw public token is the sole credential -- it is hashed before any DB lookup.
// Service-role Supabase client is used for all DB operations.
// Raw DB error messages are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidOfferResponseToken,
  markOfferResponseTokenOpened,
} from '@/lib/server/offer-response-tokens';
import type { OfferResponseTokenRow } from '@/lib/server/offer-response-tokens';
import { applyOfferResponse, offerCanRespond } from '@/lib/server/offer-accept';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';

export const runtime = 'nodejs';

// Public endpoint — rate-limit by IP to deter abuse/scraping.
const publicLimiter = makePublicLimiter(40, 60_000);

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

const OFFER_COLUMNS = [
  'id', 'business_id', 'customer_id', 'offer_number', 'status',
  'offer_date', 'valid_until',
  'subtotal', 'vat_rate', 'vat_amount', 'total',
  'notes', 'terms', 'acceptance_text',
  'updated_at',
].join(', ');

const ITEM_COLUMNS = [
  'description', 'quantity', 'unit_price', 'line_total', 'sort_order',
].join(', ');

const BUSINESS_COLUMNS = [
  'name', 'phone', 'email', 'address', 'vat_number', 'logo_url',
  'legal_name', 'trade_name', 'address_line1', 'address_line2',
  'postal_code', 'city', 'region', 'tax_office', 'website',
].join(', ');

const CUSTOMER_COLUMNS = [
  'name', 'company_name', 'email', 'address',
].join(', ');

// ---------------------------------------------------------------------------
// Row interfaces
// ---------------------------------------------------------------------------

interface OfferRow {
  id: string;
  business_id: string;
  customer_id: string | null;
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
  updated_at: string;
}

interface OfferItemRow {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number;
}

interface BusinessRow {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  vat_number: string | null;
  logo_url: string | null;
  legal_name: string | null;
  trade_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  tax_office: string | null;
  website: string | null;
}

interface CustomerRow {
  name: string;
  company_name: string | null;
  email: string | null;
  address: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers — the guards/canRespond/note+summary builders + the accept/reject
// side effects now live in '@/lib/server/offer-accept' so this route and the
// folder portal endpoint share one path. The map* helpers below are GET-only.
// ---------------------------------------------------------------------------

function mapItems(rows: OfferItemRow[]) {
  return rows.map((r) => ({
    description: r.description,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    lineTotal: r.line_total,
    sortOrder: r.sort_order,
  }));
}

function mapOfferForPublic(offer: OfferRow, items: OfferItemRow[]) {
  return {
    offerNumber: offer.offer_number,
    status: offer.status,
    offerDate: offer.offer_date,
    validUntil: offer.valid_until,
    items: mapItems(items),
    subtotal: offer.subtotal,
    vatRate: offer.vat_rate,
    vatAmount: offer.vat_amount,
    total: offer.total,
    notes: offer.notes,
    terms: offer.terms,
    acceptanceText: offer.acceptance_text,
  };
}

function mapBusiness(row: BusinessRow) {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    vatNumber: row.vat_number,
    logoUrl: row.logo_url,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    postalCode: row.postal_code,
    city: row.city,
    region: row.region,
    taxOffice: row.tax_office,
    website: row.website,
  };
}

function mapCustomer(row: CustomerRow) {
  return {
    name: row.name,
    companyName: row.company_name,
    email: row.email,
    address: row.address,
  };
}

// ---------------------------------------------------------------------------
// GET /api/offer-response/[token]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;

  // Validate token (hashes internally, queries DB with service_role)
  let tokenRow: OfferResponseTokenRow | null;
  try {
    tokenRow = await findValidOfferResponseToken(rawToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, error: 'offer_response_link_invalid_or_expired' },
      { status: 404 }
    );
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  try {
    // Fetch offer
    const { data: offerData, error: offerError } = await supabase
      .from('offers')
      .select(OFFER_COLUMNS)
      .eq('id', tokenRow.offer_id)
      .eq('business_id', tokenRow.business_id)
      .maybeSingle();

    if (offerError) {
      return NextResponse.json(
        { ok: false, error: 'offer_response_load_failed' },
        { status: 500 }
      );
    }
    if (!offerData) {
      return NextResponse.json(
        { ok: false, error: 'offer_response_link_invalid_or_expired' },
        { status: 404 }
      );
    }

    const offer = offerData as unknown as OfferRow;

    // Fetch items (explicit business_id filter)
    const { data: itemsData, error: itemsError } = await supabase
      .from('offer_items')
      .select(ITEM_COLUMNS)
      .eq('business_id', tokenRow.business_id)
      .eq('offer_id', tokenRow.offer_id)
      .order('sort_order', { ascending: true });

    if (itemsError) {
      return NextResponse.json(
        { ok: false, error: 'offer_response_load_failed' },
        { status: 500 }
      );
    }
    const items = ((itemsData ?? []) as unknown[]) as OfferItemRow[];

    // Fetch business
    const { data: bizData, error: bizError } = await supabase
      .from('businesses')
      .select(BUSINESS_COLUMNS)
      .eq('id', tokenRow.business_id)
      .maybeSingle();

    if (bizError) {
      return NextResponse.json(
        { ok: false, error: 'offer_response_load_failed' },
        { status: 500 }
      );
    }
    const business = bizData ? mapBusiness(bizData as unknown as BusinessRow) : null;

    // Fetch customer only when offer has a customer_id (business_id filter enforces tenancy)
    let customer: ReturnType<typeof mapCustomer> | null = null;
    if (offer.customer_id) {
      const { data: custData, error: custError } = await supabase
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .eq('id', offer.customer_id)
        .eq('business_id', tokenRow.business_id)
        .maybeSingle();

      if (custError) {
        return NextResponse.json(
          { ok: false, error: 'offer_response_load_failed' },
          { status: 500 }
        );
      }
      if (custData) {
        customer = mapCustomer(custData as unknown as CustomerRow);
      }
    }

    // Mark token opened (best-effort: helper no-ops when already opened/responded)
    try {
      await markOfferResponseTokenOpened(tokenRow.id);
    } catch {
      // Intentionally swallowed -- opened tracking must not block the public page load.
    }

    return NextResponse.json({
      ok: true,
      tokenStatus: tokenRow.status,
      offer: mapOfferForPublic(offer, items),
      business,
      customer,
      canRespond: offerCanRespond(offer),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/offer-response/[token]
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  // Content-type guard
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  const { token: rawToken } = await params;

  // Parse body
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

  // Accept `response` or `action` key
  const responseRaw = raw.response ?? raw.action;
  if (responseRaw !== 'accepted' && responseRaw !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'invalid_response' }, { status: 400 });
  }
  const response = responseRaw as 'accepted' | 'rejected';

  // Extract and sanitize comment
  let comment: string | null = null;
  if (typeof raw.comment === 'string') {
    const trimmed = raw.comment.trim();
    if (trimmed.length > 0) {
      comment = trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
    }
  }

  // Validate token
  let tokenRow: OfferResponseTokenRow | null;
  try {
    tokenRow = await findValidOfferResponseToken(rawToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, error: 'offer_response_link_invalid_or_expired' },
      { status: 404 }
    );
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  // Fetch offer
  let offer: OfferRow;
  try {
    const { data: offerData, error: offerError } = await supabase
      .from('offers')
      .select(OFFER_COLUMNS)
      .eq('id', tokenRow.offer_id)
      .eq('business_id', tokenRow.business_id)
      .maybeSingle();

    if (offerError) {
      return NextResponse.json(
        { ok: false, error: 'offer_response_load_failed' },
        { status: 500 }
      );
    }
    if (!offerData) {
      return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
    }
    offer = offerData as unknown as OfferRow;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  // Apply the response via the shared lib (same path the folder portal uses).
  const result = await applyOfferResponse({
    supabase,
    businessId: tokenRow.business_id,
    offer,
    response,
    comment,
    sentChannel: tokenRow.sent_channel,
    tokenId: tokenRow.id,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.httpStatus });
  }

  return NextResponse.json({
    ok: true,
    response,
    offer: {
      offerNumber: result.offerNumber,
      status: result.status,
      total: result.total,
    },
  });
}
