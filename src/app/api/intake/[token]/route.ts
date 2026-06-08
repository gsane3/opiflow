import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidIntakeToken,
  markIntakeTokenOpened,
  markIntakeTokenSubmitted,
} from '@/lib/server/intake-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';

export const runtime = 'nodejs';

// Public endpoint — rate-limit by IP to deter abuse/scraping.
const publicLimiter = makePublicLimiter(40, 60_000);

// Public intake form only offers these four; the full DB set also allows
// 'phone'. 'whatsapp' and 'sms' are only valid AFTER migration 035 widens the
// customers_preferred_contact_method_check constraint — so persisting the value
// must degrade gracefully (see POST below).
const VALID_PREFERRED_CONTACT_METHODS = ['viber', 'whatsapp', 'sms', 'email'] as const;
type PreferredContactMethod = (typeof VALID_PREFERRED_CONTACT_METHODS)[number];

function preferredContactMethod(value: unknown): PreferredContactMethod | null {
  return (VALID_PREFERRED_CONTACT_METHODS as readonly string[]).includes(value as string)
    ? (value as PreferredContactMethod)
    : null;
}

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

function buildPublicIntakeRedirect(
  token: string,
  request: NextRequest,
  submitted = false
): URL {
  const publicBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  const origin = publicBaseUrl || request.nextUrl.origin;
  const suffix = submitted ? '?submitted=1' : '';

  return new URL(`/intake/${encodeURIComponent(token)}${suffix}`, origin);
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
  } catch {
    return NextResponse.json({ ok: false, error: 'intake_load_failed' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  const contentType = request.headers.get('content-type') ?? '';
  const acceptsJson = contentType.includes('application/json');
  const acceptsForm =
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data');

  if (!acceptsJson && !acceptsForm) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  try {
    const { token } = await params;
    const { tokenRow, customer } = await getCustomerForToken(token);

    if (!tokenRow || !customer) {
      if (acceptsForm) {
        return NextResponse.redirect(buildPublicIntakeRedirect(token, request), 303);
      }

      return NextResponse.json({ ok: false, error: 'intake_link_invalid_or_expired' }, { status: 404 });
    }

    let raw: Record<string, unknown>;

    if (acceptsJson) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
      }

      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
      }

      raw = body as Record<string, unknown>;
    } else {
      const formData = await request.formData();
      raw = Object.fromEntries(formData.entries());
    }

    const firstName = str(raw.firstName);
    const lastName = str(raw.lastName);
    const email = str(raw.email);
    const address = str(raw.address);
    const comments = str(raw.comments);
    const preferred = preferredContactMethod(raw.preferredContactMethod);

    if (!firstName && !lastName) {
      if (acceptsForm) {
        return NextResponse.redirect(buildPublicIntakeRedirect(token, request), 303);
      }

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
      if (acceptsForm) {
        return NextResponse.redirect(buildPublicIntakeRedirect(token, request), 303);
      }

      return NextResponse.json({ ok: false, error: 'customer_update_failed' }, { status: 500 });
    }

    if (!data) {
      if (acceptsForm) {
        return NextResponse.redirect(buildPublicIntakeRedirect(token, request), 303);
      }

      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    // Persist the customer's preferred contact channel in its OWN isolated
    // update so it can never break the core intake submission above. The DB
    // CHECK constraint only allows 'whatsapp'/'sms' AFTER migration 035 is
    // applied — if it's not yet applied, this update is rejected and we simply
    // swallow the error (the rest of the submission already succeeded).
    let updatedRow = asCustomerRow(data);
    if (preferred) {
      try {
        const { data: prefData, error: prefError } = await supabase
          .from('customers')
          .update({ preferred_contact_method: preferred, updated_at: new Date().toISOString() })
          .eq('id', customer.id)
          .eq('business_id', customer.business_id)
          .select(CUSTOMER_COLUMNS)
          .maybeSingle();

        if (!prefError && prefData) {
          updatedRow = asCustomerRow(prefData);
        }
      } catch {
        // Constraint not yet applied (or transient failure) — intentionally
        // ignore; the intake submission remains successful.
      }
    }

    await markIntakeTokenSubmitted(tokenRow.id);

    if (acceptsForm) {
      return NextResponse.redirect(buildPublicIntakeRedirect(token, request, true), 303);
    }

    return NextResponse.json({
      ok: true,
      customer: publicCustomer(updatedRow),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'intake_submit_failed' }, { status: 500 });
  }
}