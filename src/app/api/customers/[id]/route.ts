// CRM customer get-by-id and patch endpoints.
// Phase 3: business isolation enforced via explicit business_id + id filter on every query.

import { NextRequest, NextResponse } from 'next/server';
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

const VALID_STATUSES = [
  'new_lead', 'contacted', 'follow_up_needed', 'offer_drafted',
  'offer_sent', 'won', 'lost',
] as const;

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
  };
}

// Cast helper: routes Supabase's untyped query result through unknown to CustomerRow.
// Required because .select(stringVar) returns GenericStringError without a DB schema type.
function asCustomerRow(value: unknown): CustomerRow {
  return value as CustomerRow;
}

// ---------------------------------------------------------------------------
// GET /api/customers/[id]
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
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .eq('id', id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'customer_query_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, customer: dbToCustomer(asCustomerRow(data)) });
  } catch {
    return NextResponse.json({ ok: false, error: 'customer_query_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/customers/[id]
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

    // Enum validation for any provided fields
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

    // Build update object from allowed fields only.
    // crmNumber is intentionally not updatable.
    const updateFields: Record<string, unknown> = {};
    let hasUpdate = false;

    if ('name' in raw) { updateFields.name = str(raw.name); hasUpdate = true; }
    if ('companyName' in raw) { updateFields.company_name = str(raw.companyName); hasUpdate = true; }
    if ('phone' in raw) { updateFields.phone = normalizePhone(str(raw.phone)); hasUpdate = true; }
    if ('mobilePhone' in raw) { updateFields.mobile_phone = normalizePhone(str(raw.mobilePhone)); hasUpdate = true; }
    if ('landlinePhone' in raw) { updateFields.landline_phone = normalizePhone(str(raw.landlinePhone)); hasUpdate = true; }
    if ('email' in raw) { updateFields.email = str(raw.email); hasUpdate = true; }
    if ('address' in raw) { updateFields.address = str(raw.address); hasUpdate = true; }
    if ('source' in raw) { updateFields.source = isValidEnum(raw.source, VALID_SOURCES) ? raw.source : null; hasUpdate = true; }
    if ('status' in raw && isValidEnum(raw.status, VALID_STATUSES)) { updateFields.status = raw.status; hasUpdate = true; }
    if ('opportunityValue' in raw) { updateFields.opportunity_value = optionalNumber(raw.opportunityValue); hasUpdate = true; }
    if ('needsSummary' in raw) { updateFields.needs_summary = str(raw.needsSummary); hasUpdate = true; }
    if ('notes' in raw) { updateFields.notes = str(raw.notes); hasUpdate = true; }
    if ('preferredContactMethod' in raw && isValidEnum(raw.preferredContactMethod, VALID_CONTACT_METHODS)) {
      updateFields.preferred_contact_method = raw.preferredContactMethod;
      hasUpdate = true;
    }
    if ('intakeStatus' in raw && isValidEnum(raw.intakeStatus, VALID_INTAKE_STATUSES)) {
      updateFields.intake_status = raw.intakeStatus;
      hasUpdate = true;
    }
    if ('lastContactAt' in raw) { updateFields.last_contact_at = str(raw.lastContactAt); hasUpdate = true; }

    let hasMemoryFieldUpdate = false;
    if ('statusSummary' in raw) { updateFields.status_summary = str(raw.statusSummary); hasUpdate = true; hasMemoryFieldUpdate = true; }
    if ('businessNotes' in raw) { updateFields.business_notes = str(raw.businessNotes); hasUpdate = true; hasMemoryFieldUpdate = true; }
    if ('personalNotes' in raw) { updateFields.personal_notes = str(raw.personalNotes); hasUpdate = true; hasMemoryFieldUpdate = true; }
    if ('nextBestAction' in raw) { updateFields.next_best_action = str(raw.nextBestAction); hasUpdate = true; hasMemoryFieldUpdate = true; }
    if (hasMemoryFieldUpdate) { updateFields.memory_updated_at = new Date().toISOString(); }

    // If no allowed fields were provided, return the current customer unchanged.
    if (!hasUpdate) {
      const { data: existing, error: fetchError } = await supabase
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .eq('id', id)
        .eq('business_id', businessId)
        .maybeSingle();

      if (fetchError) {
        return NextResponse.json({ ok: false, error: 'customer_update_failed' }, { status: 500 });
      }
      if (!existing) {
        return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, customer: dbToCustomer(asCustomerRow(existing)) });
    }

    updateFields.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('customers')
      .update(updateFields)
      .eq('id', id)
      .eq('business_id', businessId)
      .select(CUSTOMER_COLUMNS)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'customer_update_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, customer: dbToCustomer(asCustomerRow(data)) });
  } catch {
    return NextResponse.json({ ok: false, error: 'customer_update_failed' }, { status: 500 });
  }
}
