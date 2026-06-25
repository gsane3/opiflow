// Customers — LIST (GET) + CREATE (POST) for /api/customers.
//
// Kept as a self-contained file (like customer-timeline.ts) because the LIST DTO is
// DISTINCT from both the detail and timeline DTOs (it carries postalCode/region/
// nextTaskId/pinned/importedFromPhone/needsIntake in its own key order), and the GET is
// the gnarliest tolerant assembly in the app: needs-intake pinning, pre-044 `pinned`
// ordering fallback, pin-flag annotation, and the pre-053 imported merge. Every query,
// filter, order, fallback and the exact response key order are ported verbatim from the
// live route so the JSON the web/native clients parse is byte-identical.

import { AppError } from '../../core/errors';
import { tenantDb } from '../../core/tenant';
import { CUSTOMER_COLUMNS } from './customers.types';
import { takeNextCrmNumber, type RepoContext } from './customers.repo';

// --- enums (the route's exact codes) -------------------------------------------------

const VALID_STATUSES = ['new', 'in_progress', 'won', 'lost'] as const;
const VALID_SOURCES = [
  'facebook_ads', 'google_ads', 'website_form', 'referral',
  'inbound_call', 'missed_call', 'manual_entry', 'other',
] as const;
// Must match the UPDATE route (customers/[id]) so a customer can be CREATED with
// any method they can later be PATCHed to (send-channel maps 'sms' → SMS).
const VALID_CONTACT_METHODS = ['viber', 'sms', 'email', 'phone'] as const;
const VALID_INTAKE_STATUSES = [
  'none', 'pending', 'sent', 'opened', 'submitted', 'expired', 'revoked',
] as const;

// Intake states that mean "we sent a details request and it isn't filled yet" —
// these contacts float to the very top of the list.
const NEEDS_INTAKE_STATES = ['sent', 'opened'];

// --- helpers (ported verbatim) -------------------------------------------------------

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

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  // Unknown or non-Greek input: return cleaned string, not rejected.
  return s;
}

function isValidEnum<T extends string>(value: unknown, validValues: readonly T[]): value is T {
  return typeof value === 'string' && (validValues as readonly string[]).includes(value);
}

// --- DB row + LIST DTO mapper --------------------------------------------------------

interface CustomerListRow {
  id: string;
  crm_number: string | null;
  name: string | null;
  company_name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  landline_phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  status: string;
  opportunity_value: number | null;
  needs_summary: string | null;
  notes: string | null;
  preferred_contact_method: string;
  intake_status: string;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
  status_summary: string | null;
  business_notes: string | null;
  personal_notes: string | null;
  next_best_action: string | null;
  memory_updated_at: string | null;
  pinned?: boolean;
  postal_code?: string | null;
  region?: string | null;
  imported_from_phone?: boolean | null;
}

export interface CustomerListItem {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  address: string | null;
  postalCode: string | null;
  region: string | null;
  source: string | null;
  status: string;
  opportunityValue: number | null;
  needsSummary: string | null;
  notes: string | null;
  preferredContactMethod: string;
  intakeStatus: string;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
  nextTaskId: string | null;
  statusSummary: string | null;
  businessNotes: string | null;
  personalNotes: string | null;
  nextBestAction: string | null;
  memoryUpdatedAt: string | null;
  pinned: boolean;
  importedFromPhone: boolean;
  needsIntake: boolean;
}

function asCustomerRow(value: unknown): CustomerListRow {
  return value as CustomerListRow;
}

export function dbToCustomerListItem(row: CustomerListRow): CustomerListItem {
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
    importedFromPhone: row.imported_from_phone ?? false,
    // #2: a call happened and the customer still hasn't filled their details
    // (intake request sent, awaiting). Set per-list below; default false here.
    needsIntake: false,
  };
}

// --- GET /api/customers --------------------------------------------------------------

/**
 * The full tolerant list assembly. invalid_status (400) on a bad status filter;
 * customers_query_failed (500) on a DB error. Returns the customers array (the route
 * adds `count: customers.length`).
 */
export async function listCustomersForApi(
  ctx: RepoContext,
  searchParams: URLSearchParams,
): Promise<CustomerListItem[]> {
  const statusParam = searchParams.get('status');
  const qParam = searchParams.get('q');
  // «Αναμονή στοιχείων» (#8): inbound-call contacts auto-created with no name yet.
  const awaiting = searchParams.get('awaiting') === '1';
  const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10);
  const offsetRaw = parseInt(searchParams.get('offset') ?? '0', 10);
  // sort=name → alphabetical (U7). Anything else keeps the default recency order.
  const sortByName = searchParams.get('sort') === 'name';

  if (statusParam && !isValidEnum(statusParam, VALID_STATUSES)) {
    throw new AppError('invalid_status', 400);
  }

  const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 100);
  const offset = Math.max(isNaN(offsetRaw) ? 0 : offsetRaw, 0);

  // Strip PostgREST .or()/LIKE metacharacters so a Greek term with a comma, parens,
  // % or * can't corrupt the filter or inject extra .or conditions.
  const q = qParam?.trim().replace(/[%,()*\\]/g, '').trim();

  const db = tenantDb(ctx.supabase, ctx.businessId);

  // Pinned customers (F6) are ordered FIRST at the DB level so they stay at the top of
  // the list ACROSS pagination. `pinned` is migration 044; on an older schema ordering
  // by it errors, so we retry without it (pins simply don't float).
  const buildQuery = (withPinned: boolean) => {
    let qb = db.from('customers').select(CUSTOMER_COLUMNS);
    if (statusParam) qb = qb.eq('status', statusParam);
    if (awaiting) qb = qb.is('name', null).eq('source', 'inbound_call');
    if (q) {
      qb = qb.or(
        `name.ilike.%${q}%,company_name.ilike.%${q}%,phone.ilike.%${q}%,mobile_phone.ilike.%${q}%,email.ilike.%${q}%`,
      );
    }
    if (withPinned) qb = qb.order('pinned', { ascending: false, nullsFirst: false });
    // Pins stay first; within each group either alphabetical (sort=name) or recency.
    qb = sortByName
      ? qb.order('name', { ascending: true, nullsFirst: false })
      : qb.order('created_at', { ascending: false });
    return qb.range(offset, offset + limit - 1);
  };

  let { data, error } = await buildQuery(true);
  if (error) {
    // pre-044 schema (no `pinned` column to order by) → retry without it.
    ({ data, error } = await buildQuery(false));
  }
  if (error) {
    throw new AppError('customers_query_failed', 500);
  }

  let customers = ((data ?? []) as unknown[]).map((row) => dbToCustomerListItem(asCustomerRow(row)));

  // «Λείπουν στοιχεία» pinning (#2): contacts that had a call and were sent an intake
  // request they still haven't filled float to the very TOP of the list (above pins +
  // alphabetical). Fetched separately and prepended on the first page only. Skipped when
  // a status/awaiting/search filter is active. Tolerant of a pre-intake_status schema.
  const needsIntakeSet = new Set<string>();
  if (offset === 0 && !awaiting && !statusParam && !q) {
    try {
      const { data: ni, error: niErr } = await db
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .in('intake_status', NEEDS_INTAKE_STATES)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!niErr && Array.isArray(ni) && ni.length > 0) {
        const niCustomers = (ni as unknown[]).map((row) => dbToCustomerListItem(asCustomerRow(row)));
        for (const c of niCustomers) needsIntakeSet.add(c.id);
        customers = [...niCustomers, ...customers.filter((c) => !needsIntakeSet.has(c.id))];
      }
    } catch {
      // intake_status not filterable on an old schema → no needs-info pinning
    }
  }
  for (const c of customers) c.needsIntake = needsIntakeSet.has(c.id);

  // Mark the pin flag on the returned rows so the client can render the pin icon.
  // Ordering is already done by the DB query above; we only set the flag here.
  // Tolerant of pre-044: a missing `pinned` column just yields no pins.
  try {
    const { data: pins, error: pinErr } = await db
      .from('customers')
      .select('id')
      .eq('pinned', true);
    if (!pinErr && Array.isArray(pins)) {
      const pinnedIds = new Set((pins as unknown as Array<{ id: string }>).map((p) => p.id));
      for (const c of customers) c.pinned = pinnedIds.has(c.id);
    }
  } catch {
    // pre-044 → leave as-is
  }

  // imported_from_phone (#9, migration 053) — tolerant merge so the native contacts
  // list can hide phone-imported contacts. A missing column (pre-053) simply leaves
  // every customer as not-imported.
  try {
    const ids = customers.map((c) => c.id);
    if (ids.length > 0) {
      const { data: flags, error: flagErr } = await db
        .from('customers')
        .select('id, imported_from_phone')
        .in('id', ids);
      if (!flagErr && Array.isArray(flags)) {
        const imported = new Set(
          (flags as unknown as Array<{ id: string; imported_from_phone: boolean | null }>)
            .filter((f) => f.imported_from_phone)
            .map((f) => f.id),
        );
        for (const c of customers) c.importedFromPhone = imported.has(c.id);
      }
    }
  } catch {
    // pre-053 → leave importedFromPhone false
  }

  return customers;
}

// --- POST /api/customers -------------------------------------------------------------

/**
 * Create a customer with the route's EXACT validation codes (invalid_status/_source/
 * _preferred_contact_method/_intake_status, invalid_customer; customer_create_failed on
 * insert error) and the isolated pre-053-tolerant importedFromPhone write. Returns the
 * created list-item.
 */
export async function createCustomerForApi(
  ctx: RepoContext,
  raw: Record<string, unknown>,
): Promise<CustomerListItem> {
  // Enum validation (null/undefined skips check and uses the default below)
  if (raw.status != null && !isValidEnum(raw.status, VALID_STATUSES)) {
    throw new AppError('invalid_status', 400);
  }
  if (raw.source != null && !isValidEnum(raw.source, VALID_SOURCES)) {
    throw new AppError('invalid_source', 400);
  }
  if (raw.preferredContactMethod != null && !isValidEnum(raw.preferredContactMethod, VALID_CONTACT_METHODS)) {
    throw new AppError('invalid_preferred_contact_method', 400);
  }
  if (raw.intakeStatus != null && !isValidEnum(raw.intakeStatus, VALID_INTAKE_STATUSES)) {
    throw new AppError('invalid_intake_status', 400);
  }

  const name = str(raw.name);
  const companyName = str(raw.companyName);
  const phone = normalizePhone(str(raw.phone));
  const mobilePhone = normalizePhone(str(raw.mobilePhone));
  const email = str(raw.email);

  // At least one identifying field must have a value
  if (!name && !companyName && !phone && !mobilePhone && !email) {
    throw new AppError('invalid_customer', 400);
  }

  const crmNumber = await takeNextCrmNumber(ctx);
  const db = tenantDb(ctx.supabase, ctx.businessId);

  const { data, error } = await db
    .from('customers')
    .insert({
      crm_number: crmNumber,
      name,
      company_name: companyName,
      phone,
      mobile_phone: mobilePhone,
      landline_phone: normalizePhone(str(raw.landlinePhone)),
      email,
      address: str(raw.address),
      source: isValidEnum(raw.source, VALID_SOURCES) ? raw.source : 'manual_entry',
      status: isValidEnum(raw.status, VALID_STATUSES) ? raw.status : 'new',
      opportunity_value: optionalNumber(raw.opportunityValue),
      needs_summary: str(raw.needsSummary),
      notes: str(raw.notes),
      preferred_contact_method: isValidEnum(raw.preferredContactMethod, VALID_CONTACT_METHODS)
        ? raw.preferredContactMethod
        : 'phone',
      intake_status: isValidEnum(raw.intakeStatus, VALID_INTAKE_STATUSES)
        ? raw.intakeStatus
        : 'none',
      last_contact_at: str(raw.lastContactAt) ?? null,
      status_summary: str(raw.statusSummary),
      business_notes: str(raw.businessNotes),
      personal_notes: str(raw.personalNotes),
      next_best_action: str(raw.nextBestAction),
      memory_updated_at: (str(raw.statusSummary) || str(raw.businessNotes) || str(raw.personalNotes) || str(raw.nextBestAction)) ? new Date().toISOString() : null,
    })
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error || !data) {
    throw new AppError('customer_create_failed', 500);
  }

  const created = dbToCustomerListItem(asCustomerRow(data));

  // Mark phone-address-book imports (#9) in their own isolated update so a pre-053
  // deployment can't fail the create. Native contact-import sends this.
  if (raw.importedFromPhone === true) {
    try {
      await db
        .from('customers')
        .update({ imported_from_phone: true })
        .eq('id', created.id);
      created.importedFromPhone = true;
    } catch {
      // pre-053 → swallowed; the customer was still created.
    }
  }

  return created;
}
