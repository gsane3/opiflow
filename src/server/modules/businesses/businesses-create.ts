// Businesses — CREATE (POST /api/businesses), the onboarding/signup orchestration.
//
// Kept in its own additive file because it is the heaviest orchestration in the app:
// package + voucher validation, the business insert, the owner-membership insert, the
// subscription insert (with the migration-061-absent CHECK-violation retry), voucher
// redemption, phone-pool assignment and the pending-number-request fallback — each with
// its own rollback. The route keeps its bespoke Bearer + getUser auth VERBATIM (the
// caller has NO business yet, so requireBusinessUser can't be used) and the outer
// business_create_failed catch-all; this function throws AppError for every known code
// so the route maps them to the byte-identical responses. `assignPhoneNumber` is injected
// (its lib drags the `@/` alias) so the unit tests stay hermetic.

import { AppError } from '../../core/errors';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

const VALID_TYPES = ['technical_services', 'sales_services', 'projects_construction', 'other'] as const;
const VALID_CONTACT_METHODS = ['phone', 'email', 'viber'] as const;

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface PhoneAssignmentResult {
  assigned: boolean;
  e164Number: string | null;
  managedPhoneNumberId: string | null;
}

export interface CreateBusinessDeps {
  assignPhoneNumber: (supabase: SupabaseServer, businessId: string, city?: string | null) => Promise<PhoneAssignmentResult>;
}

export interface CreateBusinessResult {
  business: Record<string, unknown>;
  phoneAssigned: boolean;
  subscriptionStatus: string;
  numberRequest: { status: string; requestedCity: string | null } | null;
}

/**
 * Create a business for the authenticated owner. Validates with the route's EXACT codes
 * (invalid_input / invalid_postal_code / invalid_website / invalid_package / invalid_voucher
 * / expired_voucher; business_already_exists 409; business_create_failed 500;
 * subscription_init_failed 500), then runs the create + rollback orchestration. Returns the
 * success payload the route wraps in the 201 response.
 */
export async function createBusinessForOwner(
  supabase: SupabaseServer,
  userId: string,
  raw: Record<string, unknown>,
  deps: CreateBusinessDeps,
): Promise<CreateBusinessResult> {
  const name = str(raw.name);
  if (!name) {
    throw new AppError('invalid_input', 400);
  }

  const type = str(raw.type);
  if (type !== null && !(VALID_TYPES as readonly string[]).includes(type)) {
    throw new AppError('invalid_input', 400);
  }

  const preferredContactMethod = str(raw.preferred_contact_method) ?? 'phone';
  if (!(VALID_CONTACT_METHODS as readonly string[]).includes(preferredContactMethod)) {
    throw new AppError('invalid_input', 400);
  }

  // Validate city (optional, max 100 chars)
  const cityVal = str(raw.city);
  if (cityVal !== null && cityVal.length > 100) {
    throw new AppError('invalid_input', 400);
  }

  const rawVatRate = raw.default_vat_rate;
  let defaultVatRate = 24;
  if (rawVatRate !== undefined && rawVatRate !== null) {
    const n = Number(rawVatRate);
    if (!isFinite(n)) {
      throw new AppError('invalid_input', 400);
    }
    defaultVatRate = n;
  }

  // postal_code must be exactly 5 digits if provided.
  const postalCodeVal = str(raw.postal_code);
  if (postalCodeVal !== null && !/^\d{5}$/.test(postalCodeVal)) {
    throw new AppError('invalid_postal_code', 400);
  }

  // website must start with http:// or https:// if provided.
  const websiteVal = str(raw.website);
  if (websiteVal !== null && !/^https?:\/\/.+/.test(websiteVal)) {
    throw new AppError('invalid_website', 400);
  }

  // -------------------------------------------------------------------------
  // Package and voucher validation
  // -------------------------------------------------------------------------

  // packageKey is required. Normalized to lowercase, max 50 chars.
  const rawPackageKey = raw['packageKey'];
  if (typeof rawPackageKey !== 'string' || !rawPackageKey.trim()) {
    throw new AppError('invalid_package', 400);
  }
  let packageKey = rawPackageKey.trim().toLowerCase().slice(0, 50);
  if (!/^[a-z0-9_-]{1,50}$/.test(packageKey)) {
    throw new AppError('invalid_package', 400);
  }

  // voucherCode is optional. Trimmed, max 50 chars.
  let voucherCode: string | null = null;
  const rawVoucherCode = raw['voucherCode'];
  if (rawVoucherCode !== undefined && rawVoucherCode !== null) {
    if (typeof rawVoucherCode !== 'string') {
      throw new AppError('invalid_voucher', 400);
    }
    const trimmedVoucher = rawVoucherCode.trim();
    if (trimmedVoucher.length > 50) {
      throw new AppError('invalid_voucher', 400);
    }
    if (trimmedVoucher.length > 0) {
      voucherCode = trimmedVoucher;
    }
  }

  // Validate packageKey against active package_plans.
  const { data: planRow, error: planQueryError } = await supabase
    .from('package_plans')
    .select('plan_key')
    .eq('plan_key', packageKey)
    .eq('active', true)
    .maybeSingle();

  if (planQueryError || !planRow) {
    throw new AppError('invalid_package', 400);
  }

  // Validate voucherCode if provided.
  type ValidVoucher = { id: string; voucher_type: string; current_redemptions: number };
  let validVoucher: ValidVoucher | null = null;

  if (voucherCode !== null) {
    const { data: voucherRow, error: voucherQueryError } = await supabase
      .from('voucher_codes')
      .select('id, voucher_type, active, max_redemptions, current_redemptions, expires_at')
      .eq('code', voucherCode)
      .maybeSingle();

    type VoucherRow = {
      id:                  string;
      voucher_type:        string;
      active:              boolean;
      max_redemptions:     number | null;
      current_redemptions: number;
      expires_at:          string | null;
    };
    const vr = voucherRow as unknown as VoucherRow | null;

    if (voucherQueryError || !vr || !vr.active) {
      throw new AppError('invalid_voucher', 400);
    }
    if (vr.expires_at !== null && new Date(vr.expires_at) < new Date()) {
      throw new AppError('expired_voucher', 400);
    }
    if (vr.max_redemptions !== null && vr.current_redemptions >= vr.max_redemptions) {
      throw new AppError('invalid_voucher', 400);
    }

    validVoucher = {
      id:                  vr.id,
      voucher_type:        vr.voucher_type,
      current_redemptions: vr.current_redemptions,
    };
  }

  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();

  if (existing) {
    throw new AppError('business_already_exists', 409);
  }

  const { data: business, error: insertError } = await supabase
    .from('businesses')
    .insert({
      owner_id: userId,
      name,
      logo_url: str(raw.logoDataUrl) ?? str(raw.logo_url),
      type: type ?? null,
      phone: str(raw.phone),
      email: str(raw.email),
      address: str(raw.address),
      city: cityVal,
      vat_number: str(raw.vat_number),
      tax_office: str(raw.tax_office),
      default_vat_rate: defaultVatRate,
      default_offer_terms: str(raw.default_offer_terms),
      default_acceptance_text: str(raw.default_acceptance_text),
      preferred_contact_method: preferredContactMethod,
      legal_name:       str(raw.legal_name),
      trade_name:       str(raw.trade_name),
      owner_first_name: str(raw.owner_first_name),
      owner_last_name:  str(raw.owner_last_name),
      address_line1:    str(raw.address_line1),
      address_line2:    str(raw.address_line2),
      postal_code:      postalCodeVal,
      region:           str(raw.region),
      website:          websiteVal,
    })
    .select(
      'id, owner_id, name, type, phone, email, address, city, vat_number, tax_office, logo_url, default_vat_rate, default_offer_terms, default_acceptance_text, preferred_contact_method, business_phone_number, legal_name, trade_name, owner_first_name, owner_last_name, address_line1, address_line2, postal_code, region, website, created_at, updated_at'
    )
    .single();

  if (insertError || !business) {
    throw new AppError('business_create_failed', 500);
  }

  const { error: memberError } = await supabase
    .from('business_users')
    .insert({
      business_id: business.id,
      user_id: userId,
      role: 'owner',
      accepted_at: new Date().toISOString(),
    });

  if (memberError) {
    await supabase.from('businesses').delete().eq('id', business.id);
    throw new AppError('business_create_failed', 500);
  }

  const bizId = (business as unknown as { id: string }).id;

  // Insert business_subscriptions row. New self-serve signups must pay before
  // access → 'pending_payment' (NOT entitled); the Stripe webhook flips them to
  // 'active' after checkout. Voucher signups are entitled immediately ('trialing').
  // Tolerant: if migration 061 (which adds 'pending_payment' to the status CHECK)
  // isn't applied yet, the insert hits a CHECK violation (23514) and we retry with
  // the legacy entitled status so signup keeps working pre-migration.
  const desiredStatus: string = validVoucher !== null ? 'trialing' : 'pending_payment';
  const insertSubscription = (status: string) =>
    supabase.from('business_subscriptions').insert({
      business_id:     bizId,
      plan_key:        packageKey,
      status,
      voucher_code_id: validVoucher !== null ? validVoucher.id : null,
    });

  // Track the status actually written (the response reports it to the client).
  let subscriptionStatus = desiredStatus;
  let { error: subError } = await insertSubscription(desiredStatus);
  if (subError && subError.code === '23514' && desiredStatus === 'pending_payment') {
    subscriptionStatus = 'pending_manual_review';
    ({ error: subError } = await insertSubscription('pending_manual_review'));
  }
  // plan_key FK: 'base'/'premium' exist only after migration 069. Pre-069, a
  // tier signup would hit 23503 — retry with the legacy plan so signup never
  // breaks on a pending migration (the webhook re-stamps the tier later).
  if (subError && subError.code === '23503' && packageKey !== 'pro') {
    packageKey = 'pro';
    ({ error: subError } = await insertSubscription(subscriptionStatus));
  }

  // A business with NO subscription row can never be activated later (the Stripe
  // webhook would have nothing to update), so fail loudly + roll back instead of
  // leaving an orphaned business.
  if (subError) {
    await supabase.from('business_users').delete().eq('business_id', bizId);
    await supabase.from('businesses').delete().eq('id', bizId);
    throw new AppError('subscription_init_failed', 500);
  }

  // If a valid voucher was used, record the redemption and increment counter.
  // The counter update is not atomic at this scale; acceptable for MVP.
  if (validVoucher !== null) {
    await supabase.from('voucher_redemptions').insert({
      voucher_code_id: validVoucher.id,
      user_id:         userId,
      business_id:     bizId,
    });
    await supabase
      .from('voucher_codes')
      .update({
        current_redemptions: validVoucher.current_redemptions + 1,
        updated_at:          new Date().toISOString(),
      })
      .eq('id', validVoucher.id);
  }

  const phoneResult = await deps.assignPhoneNumber(supabase, bizId, cityVal);

  // If no number was assigned from the pool, record a pending request so the
  // admin can fulfil the assignment manually. Non-fatal: business creation
  // succeeds regardless of whether this insert succeeds.
  let numberRequest: { status: string; requestedCity: string | null } | null = null;
  if (!phoneResult.assigned) {
    try {
      const { error: reqInsertError } = await supabase
        .from('phone_number_requests')
        .insert({
          business_id:    bizId,
          requested_city: cityVal ?? null,
          source:         'onboarding',
          status:         'pending',
        });
      if (!reqInsertError) {
        numberRequest = { status: 'pending', requestedCity: cityVal ?? null };
      }
    } catch {
      // Non-fatal: pending request creation does not block business creation.
    }
  }

  return {
    business: {
      ...(business as Record<string, unknown>),
      business_phone_number: phoneResult.assigned ? phoneResult.e164Number : null,
    },
    phoneAssigned:      phoneResult.assigned,
    subscriptionStatus,
    numberRequest,
  };
}
