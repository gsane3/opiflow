import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidIntakeToken,
  markIntakeTokenOpened,
  markIntakeTokenSubmitted,
} from '@/lib/server/intake-tokens';

export const runtime = 'nodejs';

const CUSTOMER_COLUMNS = [
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

interface CustomerRow {
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

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function publicCustomer(row: CustomerRow) {
  return {
    crmNumber: row.crm_number,
    displayName: row.name ?? row.company_name ?? row.crm_number ?? 'Πελάτης',
    phoneMasked: maskPhone(row.phone ?? row.mobile_phone ?? row.landline_phone),
    email: row.email,
    address: row.address,
    notes: row.notes,
    needsSummary: row.needs_summary,
    intakeStatus: row.intake_status,
  };
}

function asCustomerRow(value: unknown): CustomerRow {
  return value as CustomerRow;
}

function buildName(firstName: string | null, lastName: string | null): string | null {
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

async function getCustomerForToken(rawToken: string) {
  const tokenRow = await findValidIntakeToken(rawToken);

  if (!tokenRow) {
    return { tokenRow: null, customer: null };
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('id', tokenRow.customer_id)
    .eq('business_id', tokenRow.business_id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load intake customer: ${error.message}`);
  }

  return {
    tokenRow,
    customer: data ? asCustomerRow(data) : null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const { tokenRow, customer } = await getCustomerForToken(token);

    if (!tokenRow || !customer) {
      return NextResponse.json({ ok: false, error: 'intake_link_invalid_or_expired' }, { status: 404 });
    }

    await markIntakeTokenOpened(tokenRow.id);

    return NextResponse.json({
      ok: true,
      customer: publicCustomer(customer),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'intake_load_failed' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  try {
    const { token } = await params;
    const { tokenRow, customer } = await getCustomerForToken(token);

    if (!tokenRow || !customer) {
      return NextResponse.json({ ok: false, error: 'intake_link_invalid_or_expired' }, { status: 404 });
    }

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
    const firstName = str(raw.firstName);
    const lastName = str(raw.lastName);
    const email = str(raw.email);
    const address = str(raw.address);
    const comments = str(raw.comments);

    if (!firstName && !lastName) {
      return NextResponse.json({ ok: false, error: 'missing_name' }, { status: 400 });
    }

    const name = buildName(firstName, lastName);
    const now = new Date().toISOString();
    const notesParts = [
      customer.notes,
      comments ? `Σχόλια φόρμας: ${comments}` : null,
    ].filter(Boolean);

    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from('customers')
      .update({
        name,
        email,
        address,
        notes: notesParts.length > 0 ? notesParts.join('\n\n') : null,
        intake_status: 'submitted',
        updated_at: now,
      })
      .eq('id', customer.id)
      .eq('business_id', customer.business_id)
      .select(CUSTOMER_COLUMNS)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'customer_update_failed' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    await markIntakeTokenSubmitted(tokenRow.id);

    return NextResponse.json({
      ok: true,
      customer: publicCustomer(asCustomerRow(data)),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'intake_submit_failed' },
      { status: 500 }
    );
  }
}
