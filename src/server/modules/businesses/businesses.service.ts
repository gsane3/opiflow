// Businesses — service (validation + orchestration). Parity-matched to
// /api/businesses/me and /api/businesses/me/bank.
//
// Validation produces the routes' EXACT error codes (invalid_name/_type/
// _contact_method/_vat_rate/_postal_code/_website/logo_too_large/invalid_logo,
// invalid_iban) and preserves the exact ORDER + lenient coercions (trim → null).
// Per-operation DB codes come from the repo. The bank-PATCH write-through is wrapped
// in one try/catch → bank_unavailable (503) so any lib failure degrades like the
// original, while AppError validation throws pass through unchanged.

import { AppError } from '../../core/errors';
import { isEntitled } from '../../../lib/billing/entitlement';
import { isStripeConfigured } from '../../../lib/billing/stripe';
import {
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  syncPrimaryBank,
} from '../../../lib/server/bank-accounts';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  findOwnedBusinessId,
  getBankMirror,
  getBusinessById,
  getPendingNumberRequest,
  getSubscription,
  updateOwnedBusiness,
} from './businesses.repo';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

const PATCH_VALID_TYPES = ['technical_services', 'sales_services', 'projects_construction', 'other'] as const;
const PATCH_VALID_CONTACT_METHODS = ['phone', 'email', 'viber'] as const;

export function patchStr(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const MAX_LEN = 200;

export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > MAX_LEN ? t.slice(0, MAX_LEN) : t;
}

/** Normalize an IBAN: strip spaces, upper-case. */
export function normalizeIban(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').toUpperCase();
  return s.length > 0 ? s : null;
}

/** Loose structural IBAN check (2 letters + 2 digits + 11–30 alphanumerics). */
export function isValidIban(s: string): boolean {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s);
}

export interface MeResult {
  business: Record<string, unknown>;
  phoneAssigned: boolean;
  activationAllowed: boolean;
  billingConfigured: boolean;
  subscription: { plan_key: string; status: string; trial_ends_at: string | null } | null;
  numberRequest: { status: string; requestedCity: string | null; createdAt: string } | null;
}

/**
 * GET /api/businesses/me payload. business_not_found (404) when missing; per-op
 * codes (business_query_failed / subscription_query_failed / number_request_query_failed)
 * on DB error. Mirrors the route's exact computed fields + key order.
 */
export async function getBusinessMe(
  supabase: SupabaseServer,
  businessId: string,
): Promise<MeResult> {
  const business = await getBusinessById(supabase, businessId);
  if (!business) throw new AppError('business_not_found', 404);

  const biz = business;
  const bizId = biz.id as string;

  const sub = await getSubscription(supabase, bizId);
  const activationAllowed = isEntitled(sub?.status);
  const subscription = sub
    ? {
        plan_key:      sub.plan_key,
        status:        sub.status,
        trial_ends_at: sub.trial_ends_at ?? null,
      }
    : null;

  const req = await getPendingNumberRequest(supabase, bizId);
  const numberRequest = req
    ? {
        status:        req.status,
        requestedCity: req.requested_city ?? null,
        createdAt:     req.created_at,
      }
    : null;

  return {
    business,
    phoneAssigned:
      typeof biz.business_phone_number === 'string' && (biz.business_phone_number as string).length > 0,
    activationAllowed,
    billingConfigured: isStripeConfigured(),
    subscription,
    numberRequest,
  };
}

/**
 * PATCH /api/businesses/me. Validates with the route's exact codes/order/coercions,
 * enforces owner ownership (business_not_found when the user owns no business), builds
 * the partial-update payload (omitted optional keys are never written), and returns the
 * updated row. business_update_failed (500) on DB error.
 */
export async function updateBusinessMe(
  supabase: SupabaseServer,
  userId: string,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // name is required and must not be blank.
  const name = patchStr(raw.name);
  if (!name) throw new AppError('invalid_name', 400);

  // type is required and must be a recognised business type.
  const type = patchStr(raw.type);
  if (!type || !(PATCH_VALID_TYPES as readonly string[]).includes(type)) {
    throw new AppError('invalid_type', 400);
  }

  // preferred_contact_method is required and must be a recognised method.
  const preferredContactMethod = patchStr(raw.preferred_contact_method);
  if (!preferredContactMethod || !(PATCH_VALID_CONTACT_METHODS as readonly string[]).includes(preferredContactMethod)) {
    throw new AppError('invalid_contact_method', 400);
  }

  // default_vat_rate must be a finite number in [0, 100].
  let defaultVatRate: number | undefined;
  if (raw.default_vat_rate !== undefined && raw.default_vat_rate !== null) {
    const n = Number(raw.default_vat_rate);
    if (!isFinite(n) || n < 0 || n > 100) {
      throw new AppError('invalid_vat_rate', 400);
    }
    defaultVatRate = n;
  }

  // postal_code must be exactly 5 digits if provided.
  const postalCodeRaw = patchStr(raw.postal_code);
  if (postalCodeRaw !== null && !/^\d{5}$/.test(postalCodeRaw)) {
    throw new AppError('invalid_postal_code', 400);
  }

  // website must start with http:// or https:// if provided.
  const websiteRaw = patchStr(raw.website);
  if (websiteRaw !== null && !/^https?:\/\/.+/.test(websiteRaw)) {
    throw new AppError('invalid_website', 400);
  }

  // Logo: a small data:image/* URL persisted to logo_url. '' or null clears it.
  // undefined = field omitted → leave the existing logo untouched.
  let logoUpdate: string | null | undefined;
  if (raw.logoDataUrl !== undefined) {
    const lv = raw.logoDataUrl;
    if (lv === null || lv === '') {
      logoUpdate = null;
    } else if (typeof lv === 'string' && /^data:image\/(png|jpe?g|webp|svg\+xml);base64,/.test(lv)) {
      if (lv.length > 300_000) {
        throw new AppError('logo_too_large', 400);
      }
      logoUpdate = lv;
    } else {
      throw new AppError('invalid_logo', 400);
    }
  }

  // Verify the business exists and belongs to this user.
  const existing = await findOwnedBusinessId(supabase, userId);
  if (!existing) throw new AppError('business_not_found', 404);

  // Build the update payload. Only editable profile fields are accepted.
  const updates: Record<string, unknown> = {
    name,
    type,
    preferred_contact_method: preferredContactMethod,
    updated_at:               new Date().toISOString(),
  };

  // Plain string fields (body key === column name); '' → null clears, omitted → untouched.
  const OPTIONAL_STR_FIELDS = [
    'phone', 'email', 'address', 'city', 'vat_number', 'tax_office',
    'default_offer_terms', 'default_acceptance_text', 'legal_name', 'trade_name',
    'owner_first_name', 'owner_last_name', 'address_line1', 'address_line2',
    'region', 'facebook_url', 'instagram_url',
  ] as const;
  for (const f of OPTIONAL_STR_FIELDS) {
    if (f in raw) updates[f] = patchStr(raw[f]);
  }
  // Validated optional fields (validation above already ran on these).
  if ('postal_code' in raw) updates.postal_code = postalCodeRaw;
  if ('website' in raw) updates.website = websiteRaw;
  if (defaultVatRate !== undefined) {
    updates.default_vat_rate = defaultVatRate;
  }
  if (logoUpdate !== undefined) {
    updates.logo_url = logoUpdate;
  }

  return updateOwnedBusiness(supabase, userId, updates);
}

export interface BankPayload {
  beneficiary: string | null;
  bank: string | null;
  iban: string | null;
}

function mapBank(row: { bank_beneficiary: string | null; bank_name: string | null; bank_iban: string | null } | null): BankPayload {
  return {
    beneficiary: row?.bank_beneficiary ?? null,
    bank: row?.bank_name ?? null,
    iban: row?.bank_iban ?? null,
  };
}

/** GET /api/businesses/me/bank — tolerant read; always { beneficiary, bank, iban }. */
export async function getBank(supabase: SupabaseServer, businessId: string): Promise<BankPayload> {
  try {
    const row = await getBankMirror(supabase, businessId);
    return mapBank(row);
  } catch {
    return mapBank(null);
  }
}

/**
 * PATCH /api/businesses/me/bank — edits the PRIMARY bank account write-through.
 * invalid_iban (400) validation throws before any side effect; any lib failure inside
 * the write-through degrades to bank_unavailable (503), matching the route's catch.
 */
export async function updateBank(businessId: string, raw: Record<string, unknown>): Promise<BankPayload> {
  let iban: string | null = null;
  if (raw.iban !== undefined && raw.iban !== null && raw.iban !== '') {
    iban = normalizeIban(raw.iban);
    if (!iban || !isValidIban(iban)) {
      throw new AppError('invalid_iban', 400);
    }
  }

  try {
    const beneficiary = cleanText(raw.beneficiary);
    const bank = cleanText(raw.bank);

    if (!iban) {
      // Clearing the bank: drop the primary account (next becomes primary, if any).
      const accounts = await listBankAccounts(businessId);
      if (accounts.length > 0) await deleteBankAccount(businessId, accounts[0].id);
      else await syncPrimaryBank(businessId);
      return mapBank(null);
    }

    const accounts = await listBankAccounts(businessId);
    const primary = accounts[0];
    const saved = primary
      ? await updateBankAccount(businessId, primary.id, { beneficiary, bankName: bank, iban })
      : await createBankAccount(businessId, { beneficiary, bankName: bank, iban });
    return {
      beneficiary: saved?.beneficiary ?? beneficiary,
      bank: saved?.bankName ?? bank,
      iban: saved?.iban ?? iban,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('bank_unavailable', 503);
  }
}
