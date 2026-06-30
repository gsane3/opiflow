// Customers — service (business logic), reference module, PR-1.
//
// The service validates input (Zod), normalizes it, orchestrates the repo, and maps
// rows to the client DTO. It NEVER touches Supabase directly (that's the repo's job)
// and NEVER builds HTTP responses (that's the route's job). Imported by no live
// route yet → zero runtime change.

import { AppError } from '../../core/errors';
import { CreateCustomerSchema, ListCustomersQuerySchema } from './customers.schema';
import { type Customer, type CustomerRow, type CustomerDetail, type CustomerDetailRow } from './customers.types';
import {
  applyCustomerBlocked,
  applyCustomerExtras,
  applyCustomerVatNumber,
  deleteAllCustomerRows,
  deleteCustomerRow,
  deleteImportedCustomerRows,
  fetchCustomerBlocked,
  fetchCustomerExtras,
  fetchCustomerPinned,
  fetchCustomerVatNumber,
  fetchCustomerRowForUpdate,
  getCustomerDetailRow,
  insertCustomerRow,
  listCustomerRows,
  listOffersForCustomerSummary,
  setCustomerPinned,
  takeNextCrmNumber,
  updateCustomerRow,
  type RepoContext,
} from './customers.repo';

// --- explicit enums + helpers for /api/customers/[id] (the route's exact codes) ---

const DETAIL_STATUSES = ['new', 'in_progress', 'won', 'lost'] as const;
const DETAIL_SOURCES = [
  'facebook_ads', 'google_ads', 'website_form', 'referral',
  'inbound_call', 'missed_call', 'manual_entry', 'other',
] as const;
const DETAIL_CONTACT_METHODS = ['viber', 'sms', 'email', 'phone'] as const;
const DETAIL_INTAKE_STATUSES = ['none', 'pending', 'sent', 'opened', 'submitted', 'expired', 'revoked'] as const;

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const t = val.trim();
  return t.length > 0 ? t : null;
}
function optionalNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}
function isValidEnum<T extends string>(value: unknown, valid: readonly T[]): value is T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value);
}

/** Greek-aware phone normalization to +30 E.164 (parity with the live route). */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  return s; // unknown / non-Greek: cleaned, not rejected
}

/** Maps a DB row (snake_case) to the client DTO (camelCase). */
export function dbToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    crmNumber: row.crm_number,
    name: row.name,
    companyName: row.company_name,
    phone: row.phone,
    mobilePhone: row.mobile_phone,
    landlinePhone: row.landline_phone,
    email: row.email,
    address: row.address,
    source: row.source,
    status: row.status,
    opportunityValue: row.opportunity_value,
    needsSummary: row.needs_summary,
    notes: row.notes,
    preferredContactMethod: row.preferred_contact_method,
    intakeStatus: row.intake_status,
    lastContactAt: row.last_contact_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusSummary: row.status_summary,
    businessNotes: row.business_notes,
    personalNotes: row.personal_notes,
    nextBestAction: row.next_best_action,
    memoryUpdatedAt: row.memory_updated_at,
  };
}

/** List customers for the caller's business. Throws ZodError on a bad query. */
export async function listCustomers(
  ctx: RepoContext,
  rawQuery: unknown,
): Promise<Customer[]> {
  const query = ListCustomersQuerySchema.parse(rawQuery);
  const rows = await listCustomerRows(ctx, query);
  return rows.map(dbToCustomer);
}

/** Create a customer. Throws ZodError on invalid input (→ 400 via handleApiError). */
export async function createCustomer(
  ctx: RepoContext,
  rawInput: unknown,
): Promise<Customer> {
  const input = CreateCustomerSchema.parse(rawInput);
  const crmNumber = await takeNextCrmNumber(ctx);

  const row = await insertCustomerRow(ctx, {
    crm_number: crmNumber,
    name: input.name ?? null,
    company_name: input.companyName ?? null,
    phone: normalizePhone(input.phone),
    mobile_phone: normalizePhone(input.mobilePhone),
    landline_phone: normalizePhone(input.landlinePhone),
    email: input.email ?? null,
    address: input.address ?? null,
    source: input.source ?? 'manual_entry',
    status: input.status ?? 'new',
    opportunity_value: input.opportunityValue ?? null,
    needs_summary: input.needsSummary ?? null,
    notes: input.notes ?? null,
    preferred_contact_method: input.preferredContactMethod ?? 'phone',
    intake_status: input.intakeStatus ?? 'none',
  });

  return dbToCustomer(row);
}

export type BulkDeleteScope = 'all' | 'imported';
export interface BulkDeleteResult {
  deleted: number;
  scope?: BulkDeleteScope;
  columnMissing?: true;
}

/**
 * Bulk-delete contacts (parity with DELETE /api/customers/imported):
 *   - 'all'      → every contact for the business.
 *   - 'imported' → only phone-imported contacts; on a pre-053 schema this returns
 *                  `{ deleted: 0, columnMissing: true }` (no `scope`) so the UI can
 *                  hint that «Διαγραφή όλων» is the way to clear contacts.
 */
export async function bulkDeleteCustomers(
  ctx: RepoContext,
  scope: BulkDeleteScope,
): Promise<BulkDeleteResult> {
  if (scope === 'all') {
    const { deleted } = await deleteAllCustomerRows(ctx);
    return { deleted, scope: 'all' };
  }
  const res = await deleteImportedCustomerRows(ctx);
  if ('columnMissing' in res) return { deleted: 0, columnMissing: true };
  return { deleted: res.deleted, scope: 'imported' };
}

// ---------------------------------------------------------------------------
// /api/customers/[id] — GET / PATCH / DELETE (detail). Parity-matched.
// ---------------------------------------------------------------------------

/** Maps a customer row to the detail DTO, IN THE EXACT KEY ORDER the live route emits. */
export function dbToCustomerDetail(row: CustomerDetailRow): CustomerDetail {
  return {
    id: row.id,
    crmNumber: row.crm_number,
    name: row.name,
    companyName: row.company_name,
    phone: row.phone,
    mobilePhone: row.mobile_phone,
    landlinePhone: row.landline_phone,
    email: row.email,
    address: row.address,
    postalCode: row.postal_code ?? null,
    region: row.region ?? null,
    importedFromPhone: row.imported_from_phone ?? false,
    blocked: row.blocked ?? false,
    vatNumber: row.vat_number ?? null,
    source: row.source,
    status: row.status,
    opportunityValue: row.opportunity_value,
    needsSummary: row.needs_summary,
    notes: row.notes,
    preferredContactMethod: row.preferred_contact_method,
    intakeStatus: row.intake_status,
    lastContactAt: row.last_contact_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextTaskId: null,
    statusSummary: row.status_summary,
    businessNotes: row.business_notes,
    personalNotes: row.personal_notes,
    nextBestAction: row.next_best_action,
    memoryUpdatedAt: row.memory_updated_at,
    pinned: row.pinned ?? false,
  };
}

/**
 * GET /api/customers/[id]. Core fetch (customer_query_failed / customer_not_found),
 * then three SEPARATE tolerant reads (pinned 044, postal/region/imported 053,
 * blocked 058) so a pending migration can't break the detail.
 */
export async function getCustomer(ctx: RepoContext, id: string): Promise<CustomerDetail> {
  const row = await getCustomerDetailRow(ctx, id);
  if (!row) throw new AppError('customer_not_found', 404);
  const customer = dbToCustomerDetail(row);

  const pinned = await fetchCustomerPinned(ctx, id);
  if (pinned !== undefined) customer.pinned = pinned;

  const extras = await fetchCustomerExtras(ctx, id);
  if (extras !== undefined) {
    customer.postalCode = extras.postalCode;
    customer.region = extras.region;
    customer.importedFromPhone = extras.importedFromPhone;
  }

  const blocked = await fetchCustomerBlocked(ctx, id);
  if (blocked !== undefined) customer.blocked = blocked;

  const vatNumber = await fetchCustomerVatNumber(ctx, id);
  if (vatNumber !== undefined) customer.vatNumber = vatNumber;

  return customer;
}

/**
 * PATCH /api/customers/[id]. Enum validation (invalid_status/_source/
 * _preferred_contact_method/_intake_status), core whitelist update, plus the
 * isolated 053 (postal/region) and 058 (blocked) writes that only reflect into the
 * response when the column actually exists. crmNumber is never updatable.
 */
export async function updateCustomer(
  ctx: RepoContext,
  id: string,
  raw: Record<string, unknown>,
): Promise<CustomerDetail> {
  if (raw.status != null && !isValidEnum(raw.status, DETAIL_STATUSES)) {
    throw new AppError('invalid_status', 400);
  }
  if (raw.source != null && !isValidEnum(raw.source, DETAIL_SOURCES)) {
    throw new AppError('invalid_source', 400);
  }
  if (raw.preferredContactMethod != null && !isValidEnum(raw.preferredContactMethod, DETAIL_CONTACT_METHODS)) {
    throw new AppError('invalid_preferred_contact_method', 400);
  }
  if (raw.intakeStatus != null && !isValidEnum(raw.intakeStatus, DETAIL_INTAKE_STATUSES)) {
    throw new AppError('invalid_intake_status', 400);
  }

  const updateFields: Record<string, unknown> = {};
  let hasUpdate = false;

  if ('name' in raw) { updateFields.name = str(raw.name); hasUpdate = true; }
  if ('companyName' in raw) { updateFields.company_name = str(raw.companyName); hasUpdate = true; }
  if ('phone' in raw) { updateFields.phone = normalizePhone(str(raw.phone)); hasUpdate = true; }
  if ('mobilePhone' in raw) { updateFields.mobile_phone = normalizePhone(str(raw.mobilePhone)); hasUpdate = true; }
  if ('landlinePhone' in raw) { updateFields.landline_phone = normalizePhone(str(raw.landlinePhone)); hasUpdate = true; }
  if ('email' in raw) { updateFields.email = str(raw.email); hasUpdate = true; }
  if ('address' in raw) { updateFields.address = str(raw.address); hasUpdate = true; }
  if ('source' in raw) { updateFields.source = isValidEnum(raw.source, DETAIL_SOURCES) ? raw.source : null; hasUpdate = true; }
  if ('status' in raw && isValidEnum(raw.status, DETAIL_STATUSES)) { updateFields.status = raw.status; hasUpdate = true; }
  if ('opportunityValue' in raw) { updateFields.opportunity_value = optionalNumber(raw.opportunityValue); hasUpdate = true; }
  if ('needsSummary' in raw) { updateFields.needs_summary = str(raw.needsSummary); hasUpdate = true; }
  if ('notes' in raw) { updateFields.notes = str(raw.notes); hasUpdate = true; }
  if ('preferredContactMethod' in raw && isValidEnum(raw.preferredContactMethod, DETAIL_CONTACT_METHODS)) {
    updateFields.preferred_contact_method = raw.preferredContactMethod;
    hasUpdate = true;
  }
  if ('intakeStatus' in raw && isValidEnum(raw.intakeStatus, DETAIL_INTAKE_STATUSES)) {
    updateFields.intake_status = raw.intakeStatus;
    hasUpdate = true;
  }
  if ('lastContactAt' in raw) { updateFields.last_contact_at = str(raw.lastContactAt); hasUpdate = true; }

  // 053 extras + 058 blocked are written in isolated updates (pre-migration safe);
  // detect them here and force a save even when they're the only edited fields.
  const extraPostal = 'postalCode' in raw ? str(raw.postalCode) : undefined;
  const extraRegion = 'region' in raw ? str(raw.region) : undefined;
  const wantsExtras = extraPostal !== undefined || extraRegion !== undefined;
  if (wantsExtras) hasUpdate = true;

  const extraBlocked = 'blocked' in raw ? raw.blocked === true : undefined;
  if (extraBlocked !== undefined) hasUpdate = true;

  // 067 vat_number — isolated write (pre-067 column-missing safe), like blocked.
  const extraVat = 'vatNumber' in raw ? str(raw.vatNumber) : undefined;
  if (extraVat !== undefined) hasUpdate = true;

  let hasMemoryFieldUpdate = false;
  if ('statusSummary' in raw) { updateFields.status_summary = str(raw.statusSummary); hasUpdate = true; hasMemoryFieldUpdate = true; }
  if ('businessNotes' in raw) { updateFields.business_notes = str(raw.businessNotes); hasUpdate = true; hasMemoryFieldUpdate = true; }
  if ('personalNotes' in raw) { updateFields.personal_notes = str(raw.personalNotes); hasUpdate = true; hasMemoryFieldUpdate = true; }
  if ('nextBestAction' in raw) { updateFields.next_best_action = str(raw.nextBestAction); hasUpdate = true; hasMemoryFieldUpdate = true; }
  if (hasMemoryFieldUpdate) { updateFields.memory_updated_at = new Date().toISOString(); }

  if (!hasUpdate) {
    const existing = await fetchCustomerRowForUpdate(ctx, id);
    if (!existing) throw new AppError('customer_not_found', 404);
    return dbToCustomerDetail(existing);
  }

  updateFields.updated_at = new Date().toISOString();
  const data = await updateCustomerRow(ctx, id, updateFields);
  if (!data) throw new AppError('customer_not_found', 404);
  const patched = dbToCustomerDetail(data);

  if (wantsExtras) {
    const extraUpdate: Record<string, unknown> = {};
    if (extraPostal !== undefined) extraUpdate.postal_code = extraPostal;
    if (extraRegion !== undefined) extraUpdate.region = extraRegion;
    const ok = await applyCustomerExtras(ctx, id, extraUpdate);
    if (ok) {
      if (extraPostal !== undefined) patched.postalCode = extraPostal;
      if (extraRegion !== undefined) patched.region = extraRegion;
    }
  }

  if (extraBlocked !== undefined) {
    const ok = await applyCustomerBlocked(ctx, id, extraBlocked);
    if (ok) patched.blocked = extraBlocked;
  }

  if (extraVat !== undefined) {
    const ok = await applyCustomerVatNumber(ctx, id, extraVat);
    if (ok) patched.vatNumber = extraVat;
  }

  return patched;
}

/** DELETE /api/customers/[id]. customer_delete_failed (500) on DB error; customer_not_found (404) when nothing matched. */
export async function deleteCustomer(ctx: RepoContext, id: string): Promise<{ deleted: number }> {
  const count = await deleteCustomerRow(ctx, id);
  if (count === 0) throw new AppError('customer_not_found', 404);
  return { deleted: count };
}

/** POST /api/customers/[id]/pin. Returns whether the write succeeded (pre-044 → false → 503 route-side). */
export async function pinCustomer(ctx: RepoContext, id: string, pinned: boolean): Promise<boolean> {
  return setCustomerPinned(ctx, id, pinned);
}

export interface OffersSummary {
  offerCount: number;
  totalValue: number;
  acceptedCount: number;
  pendingCount: number;
  latestStatus: string | null;
  latestOfferDate: string | null;
}

/** GET /api/customers/[id]/offers/summary. offers_summary_failed (500) on DB error. */
export async function getCustomerOffersSummary(ctx: RepoContext, customerId: string): Promise<OffersSummary> {
  const offers = await listOffersForCustomerSummary(ctx, customerId);
  const PENDING = new Set(['draft', 'ready_to_send', 'sent_manually']);
  let totalValue = 0;
  let acceptedCount = 0;
  let pendingCount = 0;
  for (const o of offers) {
    if (typeof o.total === 'number') totalValue += o.total;
    if (o.status === 'accepted') acceptedCount += 1;
    else if (PENDING.has(o.status)) pendingCount += 1;
  }
  const latest = offers[0] ?? null;
  return {
    offerCount: offers.length,
    totalValue,
    acceptedCount,
    pendingCount,
    latestStatus: latest?.status ?? null,
    latestOfferDate: latest?.offer_date ?? latest?.created_at ?? null,
  };
}
