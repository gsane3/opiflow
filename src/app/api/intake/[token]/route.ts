import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidIntakeToken,
  markIntakeTokenOpened,
  markIntakeTokenSubmitted,
} from '@/lib/server/intake-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { sendPushToBusinessOwner } from '@/lib/server/push';

export const runtime = 'nodejs';

// The public link is delivered over viber/sms/email; the form submission itself
// has no channel, so we reuse the delivery channel for the inbound row (default
// viber). Matches the offer/appointment-response audit-row convention.
function inboundChannel(sent: 'viber' | 'sms' | 'email' | 'manual' | null): 'viber' | 'sms' | 'email' {
  return sent === 'sms' || sent === 'email' ? sent : 'viber';
}

// Public endpoint — rate-limit by IP to deter abuse/scraping.
const publicLimiter = makePublicLimiter(40, 60_000);

// Public intake form offers these three; the full DB set also allows 'phone'.
// WhatsApp was removed in the redesign (migration 042 narrows the
// customers_preferred_contact_method_check constraint back to viber/sms/email/phone).
const VALID_PREFERRED_CONTACT_METHODS = ['viber', 'sms', 'email'] as const;
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

// Public business header (logo + name + contact) so the customer sees WHO is
// asking for their details — the brand touchpoint. Mirrors the offer page.
const BUSINESS_COLUMNS = ['name', 'legal_name', 'trade_name', 'logo_url', 'phone', 'email', 'website'].join(', ');

interface BusinessRow {
  name: string | null;
  legal_name: string | null;
  trade_name: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

export function publicBusiness(row: BusinessRow | null) {
  if (!row) return null;
  const name = row.trade_name?.trim() || row.legal_name?.trim() || row.name?.trim() || null;
  if (!name && !row.logo_url) return null;
  return {
    name: name ?? 'Η επιχείρηση',
    logoUrl: row.logo_url,
    phone: row.phone,
    email: row.email,
    website: row.website,
  };
}

export async function loadPublicBusiness(businessId: string) {
  try {
    const supabase = createServiceSupabaseClient();
    const { data } = await supabase
      .from('businesses')
      .select(BUSINESS_COLUMNS)
      .eq('id', businessId)
      .maybeSingle();
    return publicBusiness((data as unknown as BusinessRow | null) ?? null);
  } catch {
    return null;
  }
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
      business: await loadPublicBusiness(tokenRow.business_id),
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

    // Surface the customer's free-text comment as an INBOUND message so it
    // threads into the customer timeline (same pattern as offer/appointment
    // -response). Best-effort & non-fatal — the intake submission already
    // succeeded, so a failure here must not turn it into an error.
    if (comments) {
      const summary = `Σχόλιο από αίτημα στοιχείων: ${comments.slice(0, 1000)}`;
      try {
        await supabase.from('communications').insert({
          business_id: customer.business_id,
          customer_id: customer.id,
          channel: inboundChannel(tokenRow.sent_channel),
          direction: 'inbound',
          status: 'completed',
          phone: null,
          summary,
        });
      } catch {
        // intentionally swallowed
      }
      await sendPushToBusinessOwner(customer.business_id, {
        title: 'Νέο μήνυμα από πελάτη',
        body: summary,
        url: `/customers/${customer.id}`,
        data: { type: 'customer_message', source: 'intake' },
      });
    }

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