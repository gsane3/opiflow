// Public offer-response — service (post-verify orchestration for the PUBLIC token
// route). The route stays a thin shell: it does the public token verify (raw token
// hashed + looked up via the offer-response-tokens lib) and the service-role client
// creation, then hands the verified token row + scoped supabase client here. This
// service performs the DB fetches (via the repo) and the accept/reject side effects
// (via the shared offer-accept lib), preserving the route's EXACT error codes,
// statuses and response shapes byte-for-byte.
//
// Effectful libs (markOfferResponseTokenOpened, applyOfferResponse) are injected as
// deps that default to the real implementations, so the parity test stays hermetic.

import {
  markOfferResponseTokenOpened as realMarkOpened,
} from '../../../lib/server/offer-response-tokens';
import type { applyOfferResponse as ApplyOfferResponseFn } from '../../../lib/server/offer-accept';
import { offerCanRespond } from '../../../lib/server/offer-status';
import {
  fetchBusiness,
  fetchCustomer,
  fetchOffer,
  fetchOfferItems,
  type BusinessRow,
  type CustomerRow,
  type OfferItemRow,
  type OfferRow,
  type RepoContext,
} from './public-offer-response.repo';

// ---------------------------------------------------------------------------
// Pure GET-only map helpers (verbatim from the route).
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
// GET — load the public offer payload for a verified token row.
// ---------------------------------------------------------------------------

export interface LoadVerifiedToken {
  id: string;
  business_id: string;
  offer_id: string;
  status: string;
}

export interface LoadOfferResponseDeps {
  /** Best-effort opened-tracking (no-ops when already opened/responded). */
  markOpened?: (tokenId: string) => Promise<void>;
}

export type LoadOfferResponseResult =
  | {
      ok: true;
      body: {
        ok: true;
        tokenStatus: string;
        offer: ReturnType<typeof mapOfferForPublic>;
        business: ReturnType<typeof mapBusiness> | null;
        customer: ReturnType<typeof mapCustomer> | null;
        canRespond: boolean;
      };
    }
  | { ok: false; error: string; status: number };

/**
 * GET /api/offer-response/[token] post-verify logic. Mirrors the route's
 * try/catch exactly: any DB error or thrown error → offer_response_load_failed
 * (500); a missing offer → offer_response_link_invalid_or_expired (404).
 */
export async function loadOfferResponse(
  ctx: RepoContext,
  tokenRow: LoadVerifiedToken,
  deps: LoadOfferResponseDeps = {},
): Promise<LoadOfferResponseResult> {
  const markOpened = deps.markOpened ?? realMarkOpened;
  try {
    // Fetch offer
    const { data: offerData, error: offerError } = await fetchOffer(ctx, tokenRow.offer_id);
    if (offerError) {
      return { ok: false, error: 'offer_response_load_failed', status: 500 };
    }
    if (!offerData) {
      return { ok: false, error: 'offer_response_link_invalid_or_expired', status: 404 };
    }
    const offer = offerData;

    // Fetch items (explicit business_id filter)
    const { data: itemsData, error: itemsError } = await fetchOfferItems(ctx, tokenRow.offer_id);
    if (itemsError) {
      return { ok: false, error: 'offer_response_load_failed', status: 500 };
    }
    const items = (itemsData ?? []) as OfferItemRow[];

    // Fetch business
    const { data: bizData, error: bizError } = await fetchBusiness(ctx);
    if (bizError) {
      return { ok: false, error: 'offer_response_load_failed', status: 500 };
    }
    const business = bizData ? mapBusiness(bizData) : null;

    // Fetch customer only when offer has a customer_id (business_id filter enforces tenancy)
    let customer: ReturnType<typeof mapCustomer> | null = null;
    if (offer.customer_id) {
      const { data: custData, error: custError } = await fetchCustomer(ctx, offer.customer_id);
      if (custError) {
        return { ok: false, error: 'offer_response_load_failed', status: 500 };
      }
      if (custData) {
        customer = mapCustomer(custData);
      }
    }

    // Mark token opened (best-effort: helper no-ops when already opened/responded)
    try {
      await markOpened(tokenRow.id);
    } catch {
      // Intentionally swallowed -- opened tracking must not block the public page load.
    }

    return {
      ok: true,
      body: {
        ok: true,
        tokenStatus: tokenRow.status,
        offer: mapOfferForPublic(offer, items),
        business,
        customer,
        canRespond: offerCanRespond(offer),
      },
    };
  } catch {
    return { ok: false, error: 'offer_response_load_failed', status: 500 };
  }
}

// ---------------------------------------------------------------------------
// POST — apply the customer's accept/reject for a verified token row.
// ---------------------------------------------------------------------------

export interface RespondVerifiedToken {
  id: string;
  business_id: string;
  offer_id: string;
  sent_channel: 'viber' | 'sms' | 'email' | 'manual' | null;
}

export interface RespondToOfferDeps {
  /**
   * The shared accept/reject side-effect path (token + folder flows share it),
   * injected by the route. It is injected (not statically imported here) because
   * the offer-accept lib pulls in the push module, which would couple this
   * service to server-only runtime deps; the route owns that wiring.
   */
  applyOfferResponse: typeof ApplyOfferResponseFn;
}

export type RespondToOfferResult =
  | {
      ok: true;
      body: {
        ok: true;
        response: 'accepted' | 'rejected';
        offer: {
          offerNumber: string | undefined;
          status: string | undefined;
          total: number | undefined;
        };
      };
    }
  | { ok: false; error: string; status: number };

/**
 * POST /api/offer-response/[token] post-verify logic. Fetches the offer (DB error →
 * offer_response_load_failed 500; missing → offer_not_found 404; thrown → 500) then
 * applies the response via the shared lib, mapping its result verbatim.
 */
export async function respondToOffer(
  ctx: RepoContext,
  tokenRow: RespondVerifiedToken,
  input: { response: 'accepted' | 'rejected'; comment: string | null },
  deps: RespondToOfferDeps,
): Promise<RespondToOfferResult> {
  const applyOfferResponse = deps.applyOfferResponse;

  // Fetch offer
  let offer: OfferRow;
  try {
    const { data: offerData, error: offerError } = await fetchOffer(ctx, tokenRow.offer_id);
    if (offerError) {
      return { ok: false, error: 'offer_response_load_failed', status: 500 };
    }
    if (!offerData) {
      return { ok: false, error: 'offer_not_found', status: 404 };
    }
    offer = offerData;
  } catch {
    return { ok: false, error: 'offer_response_load_failed', status: 500 };
  }

  // Apply the response via the shared lib (same path the folder portal uses).
  const result = await applyOfferResponse({
    supabase: ctx.supabase,
    businessId: tokenRow.business_id,
    offer,
    response: input.response,
    comment: input.comment,
    sentChannel: tokenRow.sent_channel,
    tokenId: tokenRow.id,
  });
  if (!result.ok) {
    return { ok: false, error: result.error as string, status: result.httpStatus };
  }

  return {
    ok: true,
    body: {
      ok: true,
      response: input.response,
      offer: {
        offerNumber: result.offerNumber,
        status: result.status,
        total: result.total,
      },
    },
  };
}
