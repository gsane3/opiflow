// CRM communications list endpoint.
// Phase 8: exposes real PBX call communications created by the PBX webhook.
// Business isolation is enforced via explicit business_id filter on every query
// because the service-role client bypasses RLS.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const COMMUNICATION_COLUMNS = [
  'id',
  'customer_id',
  'channel',
  'direction',
  'status',
  'phone',
  'summary',
  'created_at',
].join(', ');

const VALID_CHANNELS = ['call', 'sms', 'viber', 'email'] as const;
const VALID_DIRECTIONS = ['inbound', 'outbound'] as const;
const VALID_POST_STATUSES = ['completed', 'failed'] as const;

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

interface CommunicationRow {
  id: string;
  customer_id: string | null;
  channel: string;
  direction: string;
  status: string;
  phone: string | null;
  summary: string | null;
  created_at: string;
}

interface CommunicationCustomerRow {
  id: string;
  crm_number: string | null;
  name: string | null;
  company_name: string | null;
  phone: string | null;
  source: string | null;
  status: string | null;
}

function getBearerToken(request: NextRequest): string | null {
  const h = request.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

function isValidEnum<T extends string>(
  value: unknown,
  validValues: readonly T[]
): value is T {
  return typeof value === 'string' && (validValues as readonly string[]).includes(value);
}

async function getBusinessId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();

  return (data as unknown as { id: string } | null)?.id ?? null;
}

function asCommunicationRow(value: unknown): CommunicationRow {
  return value as CommunicationRow;
}

function dbToCommunication(row: CommunicationRow, customer: CommunicationCustomerRow | null) {
  return {
    id: row.id,
    customerId: row.customer_id,
    channel: row.channel,
    direction: row.direction,
    status: row.status,
    phone: row.phone,
    summary: row.summary,
    createdAt: row.created_at,
    customer: customer
      ? {
          id: customer.id,
          crmNumber: customer.crm_number,
          name: customer.name,
          companyName: customer.company_name,
          phone: customer.phone,
          source: customer.source,
          status: customer.status,
        }
      : null,
  };
}

function jsonNoStore(body: object, init?: ResponseInit): NextResponse {
  const r = NextResponse.json(body, init);
  r.headers.set('Cache-Control', 'no-store');
  return r;
}

export async function GET(request: NextRequest) {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'communications_query_failed' }, { status: 500 });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    const businessId = await getBusinessId(supabase, user.id);
    if (!businessId) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    const { searchParams } = request.nextUrl;
    const channelParam = searchParams.get('channel');
    const directionParam = searchParams.get('direction');
    const customerIdParam = searchParams.get('customerId');
    const limitRaw = parseInt(searchParams.get('limit') ?? '20', 10);
    const offsetRaw = parseInt(searchParams.get('offset') ?? '0', 10);

    if (channelParam && !isValidEnum(channelParam, VALID_CHANNELS)) {
      return NextResponse.json({ ok: false, error: 'invalid_channel' }, { status: 400 });
    }

    if (directionParam && !isValidEnum(directionParam, VALID_DIRECTIONS)) {
      return NextResponse.json({ ok: false, error: 'invalid_direction' }, { status: 400 });
    }

    const limit = Math.min(Math.max(Number.isNaN(limitRaw) ? 20 : limitRaw, 1), 100);
    const offset = Math.max(Number.isNaN(offsetRaw) ? 0 : offsetRaw, 0);

    let query = supabase
      .from('communications')
      .select(COMMUNICATION_COLUMNS)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (channelParam) {
      query = query.eq('channel', channelParam);
    }

    if (directionParam) {
      query = query.eq('direction', directionParam);
    }

    if (customerIdParam) {
      query = query.eq('customer_id', customerIdParam);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: 'communications_query_failed' }, { status: 500 });
    }

    const rows = ((data ?? []) as unknown[]).map((row) => asCommunicationRow(row));
    const customerIds = Array.from(
      new Set(
        rows
          .map((row) => row.customer_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    const customersById = new Map<string, CommunicationCustomerRow>();

    if (customerIds.length > 0) {
      const { data: customerRows, error: customerError } = await supabase
        .from('customers')
        .select('id, crm_number, name, company_name, phone, source, status')
        .eq('business_id', businessId)
        .in('id', customerIds);

      if (customerError) {
        return NextResponse.json({ ok: false, error: 'customer_lookup_failed' }, { status: 500 });
      }

      for (const customer of (customerRows ?? []) as unknown[]) {
        const row = customer as CommunicationCustomerRow;
        customersById.set(row.id, row);
      }
    }

    const communications = rows.map((row) =>
      dbToCommunication(row, row.customer_id ? customersById.get(row.customer_id) ?? null : null)
    );

    return NextResponse.json({ ok: true, communications, count: communications.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'communications_query_failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = getBearerToken(request);
  if (!token) {
    return jsonNoStore({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return jsonNoStore({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return jsonNoStore({ ok: false, error: 'communications_create_failed' }, { status: 500 });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonNoStore({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    const businessId = await getBusinessId(supabase, user.id);
    if (!businessId) {
      return jsonNoStore({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonNoStore({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const { channel, direction, status, phone, customerId, customer_id, summary } = body;

    if (channel !== 'call') {
      return jsonNoStore({ ok: false, error: 'invalid_channel' }, { status: 400 });
    }

    if (!isValidEnum(direction, VALID_DIRECTIONS)) {
      return jsonNoStore({ ok: false, error: 'invalid_direction' }, { status: 400 });
    }

    if (!isValidEnum(status, VALID_POST_STATUSES)) {
      return jsonNoStore({ ok: false, error: 'invalid_status' }, { status: 400 });
    }

    // Accept camelCase customerId (preferred) or snake_case customer_id (legacy).
    const resolvedCustomerId =
      typeof customerId === 'string' && customerId.length > 0
        ? customerId
        : typeof customer_id === 'string' && customer_id.length > 0
        ? customer_id
        : null;

    const { data, error } = await supabase
      .from('communications')
      .insert({
        business_id: businessId,
        customer_id: resolvedCustomerId,
        channel: 'call',
        direction,
        status,
        phone:
          typeof phone === 'string' && phone.length > 0 ? phone : null,
        summary:
          typeof summary === 'string' && summary.length > 0 ? summary : null,
      })
      .select(COMMUNICATION_COLUMNS)
      .single();

    if (error || !data) {
      return jsonNoStore({ ok: false, error: 'communications_create_failed' }, { status: 500 });
    }

    const row = asCommunicationRow(data);
    const communication = dbToCommunication(row, null);

    return jsonNoStore({ ok: true, communication });
  } catch {
    return jsonNoStore({ ok: false, error: 'communications_create_failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const token = getBearerToken(request);
  if (!token) {
    return jsonNoStore({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return jsonNoStore({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return jsonNoStore({ ok: false, error: 'communication_delete_failed' }, { status: 500 });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonNoStore({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    const businessId = await getBusinessId(supabase, user.id);
    if (!businessId) {
      return jsonNoStore({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return jsonNoStore({ ok: false, error: 'missing_id' }, { status: 400 });
    }

    // Confirm the row belongs to this business before deleting.
    const { data: existing, error: fetchError } = await supabase
      .from('communications')
      .select('id')
      .eq('id', id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (fetchError) {
      return jsonNoStore({ ok: false, error: 'communication_delete_failed' }, { status: 500 });
    }

    if (!existing) {
      return jsonNoStore({ ok: false, error: 'communication_not_found' }, { status: 404 });
    }

    const { error: deleteError } = await supabase
      .from('communications')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId);

    if (deleteError) {
      return jsonNoStore({ ok: false, error: 'communication_delete_failed' }, { status: 500 });
    }

    return jsonNoStore({ ok: true });
  } catch {
    return jsonNoStore({ ok: false, error: 'communication_delete_failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const token = getBearerToken(request);
  if (!token) {
    return jsonNoStore({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return jsonNoStore({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return jsonNoStore({ ok: false, error: 'communication_update_failed' }, { status: 500 });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonNoStore({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    const businessId = await getBusinessId(supabase, user.id);
    if (!businessId) {
      return jsonNoStore({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return jsonNoStore({ ok: false, error: 'missing_id' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonNoStore({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const rawCustomerId = body.customerId;

    // customerId must be a non-empty string or explicit null.
    if (
      rawCustomerId !== undefined &&
      rawCustomerId !== null &&
      typeof rawCustomerId !== 'string'
    ) {
      return jsonNoStore({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const resolvedCustomerId: string | null =
      typeof rawCustomerId === 'string' && rawCustomerId.length > 0
        ? rawCustomerId
        : null;

    // If a customer id is provided, verify it belongs to the same business.
    if (resolvedCustomerId !== null) {
      const { data: customerCheck } = await supabase
        .from('customers')
        .select('id')
        .eq('id', resolvedCustomerId)
        .eq('business_id', businessId)
        .maybeSingle();

      if (!customerCheck) {
        return jsonNoStore({ ok: false, error: 'customer_not_found' }, { status: 404 });
      }
    }

    // Update the communication. The business_id filter enforces ownership.
    const { data, error } = await supabase
      .from('communications')
      .update({ customer_id: resolvedCustomerId })
      .eq('id', id)
      .eq('business_id', businessId)
      .select(COMMUNICATION_COLUMNS)
      .maybeSingle();

    if (error) {
      return jsonNoStore({ ok: false, error: 'communication_update_failed' }, { status: 500 });
    }

    if (!data) {
      return jsonNoStore({ ok: false, error: 'communication_not_found' }, { status: 404 });
    }

    const row = asCommunicationRow(data);
    const communication = dbToCommunication(row, null);

    return jsonNoStore({ ok: true, communication });
  } catch {
    return jsonNoStore({ ok: false, error: 'communication_update_failed' }, { status: 500 });
  }
}
