// Public intake — repository (data access only). Parity-matched to the two
// /api/intake/[token] routes (GET prefill + POST submit).
//
// This is a PUBLIC, TOKEN-authenticated endpoint: businessId/customerId come from
// the verified intake token (findValidIntakeToken), NOT from a business user. The
// route therefore uses the SERVICE-ROLE client (createServiceSupabaseClient) with
// EXPLICIT `.eq('business_id', …)` filters on every query — NOT tenantDb. The repo
// preserves that exactly: every function takes a ServiceClient and scopes by the
// (token-derived) businessId byte-for-byte as the original did.
//
// The token lib (intake-tokens) is an EXTERNAL effect kept behind the same thin
// calls the route used (findValidIntakeToken / markIntakeTokenOpened /
// markIntakeTokenSubmitted); the repo never reinvents the token verify/hash.

import {
  createServiceSupabaseClient,
  findValidIntakeToken,
  type IntakeTokenRow,
} from '../../../lib/server/intake-tokens';

export type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

/** Service-role client factory (re-exported so the service builds the same client the route did). */
export function createServiceClient(): ServiceClient {
  return createServiceSupabaseClient();
}

// ---------------------------------------------------------------------------
// Column lists + row shapes (verbatim from the route)
// ---------------------------------------------------------------------------

export const CUSTOMER_COLUMNS = [
  'id',
  'business_id',
  'crm_number',
  'name',
  'company_name',
  'phone',
  'mobile_phone',
  'landline_phone',
  'email',
  'address',
  'needs_summary',
  'notes',
  'intake_status',
  'updated_at',
].join(', ');

export interface CustomerRow {
  id: string;
  business_id: string;
  crm_number: string | null;
  name: string | null;
  company_name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  landline_phone: string | null;
  email: string | null;
  address: string | null;
  needs_summary: string | null;
  notes: string | null;
  intake_status: string;
  updated_at: string;
}

// postal_code / region were added in migration 053; they're read tolerantly
// (see loadCustomerExtras) so the intake form keeps working before 053 is
// applied. company_name / needs_summary exist since 003.
export interface CustomerExtras {
  postalCode: string | null;
  region: string | null;
}

// Public business header (logo + name + contact) so the customer sees WHO is
// asking for their details — the brand touchpoint. Mirrors the offer page.
export const BUSINESS_COLUMNS = ['name', 'legal_name', 'trade_name', 'logo_url', 'phone', 'email', 'website'].join(', ');

export interface BusinessRow {
  name: string | null;
  legal_name: string | null;
  trade_name: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

function asCustomerRow(value: unknown): CustomerRow {
  return value as CustomerRow;
}

// ---------------------------------------------------------------------------
// Token verify (thin pass-through to the lib — the route's exact call)
// ---------------------------------------------------------------------------

/** Verify the raw intake token. Returns the token row or null (no DB-error path of its own). */
export async function findIntakeToken(rawToken: string): Promise<IntakeTokenRow | null> {
  return findValidIntakeToken(rawToken);
}

// ---------------------------------------------------------------------------
// Customer reads / writes (service-role client, explicit business_id filter)
// ---------------------------------------------------------------------------

/**
 * Load the intake customer scoped to the token's business. Throws on DB error
 * (mirrors the route's `throw new Error(...)` which the outer route catch maps to
 * intake_load_failed / intake_submit_failed); returns null when no row.
 */
export async function selectCustomer(
  supabase: ServiceClient,
  customerId: string,
  businessId: string,
): Promise<CustomerRow | null> {
  const { data, error } = await supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load intake customer: ${error.message}`);
  }

  return data ? asCustomerRow(data) : null;
}

// Tolerant fetch of the migration-053 columns — a missing column (pre-053)
// simply yields nulls rather than failing the whole intake load.
export async function loadCustomerExtras(
  supabase: ServiceClient,
  customerId: string,
  businessId: string,
): Promise<CustomerExtras> {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('postal_code, region')
      .eq('id', customerId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (error || !data) return { postalCode: null, region: null };
    const row = data as { postal_code: string | null; region: string | null };
    return { postalCode: row.postal_code ?? null, region: row.region ?? null };
  } catch {
    return { postalCode: null, region: null };
  }
}

export async function loadPublicBusinessRow(businessId: string): Promise<BusinessRow | null> {
  try {
    const supabase = createServiceSupabaseClient();
    const { data } = await supabase
      .from('businesses')
      .select(BUSINESS_COLUMNS)
      .eq('id', businessId)
      .maybeSingle();
    return (data as unknown as BusinessRow | null) ?? null;
  } catch {
    return null;
  }
}

/** Core intake update (name/email/address/notes/intake_status + conditional company/needs). */
export async function updateCoreCustomer(
  supabase: ServiceClient,
  customerId: string,
  businessId: string,
  coreUpdate: Record<string, unknown>,
): Promise<{ data: CustomerRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from('customers')
    .update(coreUpdate)
    .eq('id', customerId)
    .eq('business_id', businessId)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle();
  return { data: data ? asCustomerRow(data) : null, error };
}

/**
 * Isolated preferred-contact-method update. Returns the updated row when it
 * succeeds; null otherwise. Swallows its own failures (the CHECK constraint may
 * not yet be applied) so the core submission stays successful.
 */
export async function updatePreferredContactMethod(
  supabase: ServiceClient,
  customerId: string,
  businessId: string,
  preferred: string,
): Promise<CustomerRow | null> {
  try {
    const { data: prefData, error: prefError } = await supabase
      .from('customers')
      .update({ preferred_contact_method: preferred, updated_at: new Date().toISOString() })
      .eq('id', customerId)
      .eq('business_id', businessId)
      .select(CUSTOMER_COLUMNS)
      .maybeSingle();

    if (!prefError && prefData) {
      return asCustomerRow(prefData);
    }
    return null;
  } catch {
    // Constraint not yet applied (or transient failure) — intentionally
    // ignore; the intake submission remains successful.
    return null;
  }
}

/**
 * Isolated postal_code / region update (migration 053). Swallows its own
 * failures so a pre-053 deployment can't fail the core intake submission.
 */
export async function updateCustomerExtras(
  supabase: ServiceClient,
  customerId: string,
  businessId: string,
  extraUpdate: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase
      .from('customers')
      .update(extraUpdate)
      .eq('id', customerId)
      .eq('business_id', businessId);
  } catch {
    // pre-053 → swallowed; intake submission already succeeded.
  }
}

/** Best-effort INBOUND communication insert for the customer's free-text comment. */
export async function insertInboundComment(
  supabase: ServiceClient,
  values: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('communications').insert(values);
  } catch {
    // intentionally swallowed
  }
}
