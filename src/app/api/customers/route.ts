// CRM customers list and create endpoints.
// Phase 3: serves the already-applied customers table from 003_crm_core.sql.
// Business isolation is enforced via explicit business_id filter on every query
// (service_role bypasses RLS, so this filter is the sole isolation mechanism).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUSTOMER_COLUMNS = [
  'id', 'crm_number', 'name', 'company_name', 'phone', 'mobile_phone',
  'landline_phone', 'email', 'address', 'source', 'status',
  'opportunity_value', 'needs_summary', 'notes', 'preferred_contact_method',
  'intake_status', 'last_contact_at', 'created_at', 'updated_at',
  'status_summary', 'business_notes', 'personal_notes', 'next_best_action', 'memory_updated_at',
].join(', ');

const VALID_STATUSES = ['new', 'in_progress', 'won', 'lost'] as const;

const VALID_SOURCES = [
  'facebook_ads', 'google_ads', 'website_form', 'referral',
  'inbound_call', 'missed_call', 'manual_entry', 'other',
] as const;

const VALID_CONTACT_METHODS = ['viber', 'email', 'phone'] as const;

const VALID_INTAKE_STATUSES = [
  'none', 'pending', 'sent', 'opened', 'submitted', 'expired', 'revoked',
] as const;

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

function isValidEnum<T extends string>(
  value: unknown,
  validValues: readonly T[]
): value is T {
  return typeof value === 'string' && (validValues as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// DB row type and mapper
// ---------------------------------------------------------------------------

interface CustomerRow {
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
  // migration 053 — read tolerantly, may be absent pre-053
  postal_code?: string | null;
  region?: string | null;
  imported_from_phone?: boolean | null;
}

function dbToCustomer(row: CustomerRow) {
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
  };
}

// Cast helper: routes Supabase's untyped query result through unknown to CustomerRow.
// Required because .select(stringVar) returns GenericStringError without a DB schema type.
function asCustomerRow(value: unknown): CustomerRow {
  return value as CustomerRow;
}

// ---------------------------------------------------------------------------
// Business lookup
// ---------------------------------------------------------------------------

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

// ---------------------------------------------------------------------------
// crm_number assignment
// ---------------------------------------------------------------------------

async function getNextCrmNumber(
  supabase: SupabaseClient,
  businessId: string
): Promise<string> {
  // Atomic per-business counter (migration 043): one UPDATE..RETURNING instead
  // of fetching every customer row, and no duplicate-number race.
  try {
    const { data: n, error } = await supabase.rpc('take_next_crm_number', {
      p_business_id: businessId,
    });
    if (!error && typeof n === 'number' && n > 0) return `#${n}`;
  } catch {
    // pre-043 schema — fall back to the legacy scan below
  }

  const { data } = await supabase
    .from('customers')
    .select('crm_number')
    .eq('business_id', businessId)
    .not('crm_number', 'is', null);

  const rows = (data ?? []) as unknown as Array<{ crm_number: string | null }>;
  const nums = rows
    .map((r) => {
      const match = r.crm_number?.match(/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `#${max + 1}`;
}

// ---------------------------------------------------------------------------
// GET /api/customers
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { searchParams } = request.nextUrl;
    const statusParam = searchParams.get('status');
    const qParam = searchParams.get('q');
    // «Αναμονή στοιχείων» (#8): inbound-call contacts auto-created with no name
    // yet — derived, no dedicated column needed.
    const awaiting = searchParams.get('awaiting') === '1';
    const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10);
    const offsetRaw = parseInt(searchParams.get('offset') ?? '0', 10);

    if (statusParam && !isValidEnum(statusParam, VALID_STATUSES)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
    }

    const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 100);
    const offset = Math.max(isNaN(offsetRaw) ? 0 : offsetRaw, 0);

    let query = supabase
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusParam) {
      query = query.eq('status', statusParam);
    }

    if (awaiting) {
      query = query.is('name', null).eq('source', 'inbound_call');
    }

    // Strip PostgREST .or()/LIKE metacharacters so a Greek term with a comma,
    // parens, % or * (e.g. an address, or "Παπαδόπουλος, Γιώργος") can't corrupt
    // the filter or inject extra .or conditions.
    const q = qParam?.trim().replace(/[%,()*\\]/g, '').trim();
    if (q) {
      query = query.or(
        `name.ilike.%${q}%,company_name.ilike.%${q}%,phone.ilike.%${q}%,mobile_phone.ilike.%${q}%,email.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: 'customers_query_failed' }, { status: 500 });
    }

    const customers = ((data ?? []) as unknown[]).map((row) => dbToCustomer(asCustomerRow(row)));

    // Mark + float pinned customers to the top (F6). Tolerant of pre-044: a
    // missing `pinned` column just yields no pins and the original order.
    try {
      const { data: pins, error: pinErr } = await supabase
        .from('customers')
        .select('id')
        .eq('business_id', businessId)
        .eq('pinned', true);
      if (!pinErr && Array.isArray(pins)) {
        const pinnedIds = new Set((pins as Array<{ id: string }>).map((p) => p.id));
        if (pinnedIds.size > 0) {
          for (const c of customers) c.pinned = pinnedIds.has(c.id);
          // Stable sort (V8): pinned first, original created_at order within groups.
          customers.sort((a, b) => Number(b.pinned) - Number(a.pinned));
        }
      }
    } catch {
      // pre-044 → leave as-is
    }

    // imported_from_phone (#9, migration 053) — tolerant merge so the native
    // contacts list can hide phone-imported contacts. A missing column (pre-053)
    // simply leaves every customer as not-imported.
    try {
      const ids = customers.map((c) => c.id);
      if (ids.length > 0) {
        const { data: flags, error: flagErr } = await supabase
          .from('customers')
          .select('id, imported_from_phone')
          .eq('business_id', businessId)
          .in('id', ids);
        if (!flagErr && Array.isArray(flags)) {
          const imported = new Set(
            (flags as Array<{ id: string; imported_from_phone: boolean | null }>)
              .filter((f) => f.imported_from_phone)
              .map((f) => f.id)
          );
          for (const c of customers) c.importedFromPhone = imported.has(c.id);
        }
      }
    } catch {
      // pre-053 → leave importedFromPhone false
    }

    return NextResponse.json({ ok: true, customers, count: customers.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'customers_query_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/customers
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

    // Enum validation (null/undefined skips check and uses the default below)
    if (raw.status != null && !isValidEnum(raw.status, VALID_STATUSES)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
    }
    if (raw.source != null && !isValidEnum(raw.source, VALID_SOURCES)) {
      return NextResponse.json({ ok: false, error: 'invalid_source' }, { status: 400 });
    }
    if (raw.preferredContactMethod != null && !isValidEnum(raw.preferredContactMethod, VALID_CONTACT_METHODS)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_preferred_contact_method' },
        { status: 400 }
      );
    }
    if (raw.intakeStatus != null && !isValidEnum(raw.intakeStatus, VALID_INTAKE_STATUSES)) {
      return NextResponse.json({ ok: false, error: 'invalid_intake_status' }, { status: 400 });
    }

    const name = str(raw.name);
    const companyName = str(raw.companyName);
    const phone = normalizePhone(str(raw.phone));
    const mobilePhone = normalizePhone(str(raw.mobilePhone));
    const email = str(raw.email);

    // At least one identifying field must have a value
    if (!name && !companyName && !phone && !mobilePhone && !email) {
      return NextResponse.json({ ok: false, error: 'invalid_customer' }, { status: 400 });
    }

    const crmNumber = await getNextCrmNumber(supabase, businessId);

    const { data, error } = await supabase
      .from('customers')
      .insert({
        business_id: businessId,
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
      return NextResponse.json({ ok: false, error: 'customer_create_failed' }, { status: 500 });
    }

    const created = dbToCustomer(asCustomerRow(data));

    // Mark phone-address-book imports (#9) in their own isolated update so a
    // pre-053 deployment can't fail the create. Native contact-import sends this.
    if (raw.importedFromPhone === true) {
      try {
        await supabase
          .from('customers')
          .update({ imported_from_phone: true })
          .eq('id', created.id)
          .eq('business_id', businessId);
        created.importedFromPhone = true;
      } catch {
        // pre-053 → swallowed; the customer was still created.
      }
    }

    return NextResponse.json(
      { ok: true, customer: created },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ ok: false, error: 'customer_create_failed' }, { status: 500 });
  }
}
