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

function dbToCommunication(row: CommunicationRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    channel: row.channel,
    direction: row.direction,
    status: row.status,
    phone: row.phone,
    summary: row.summary,
    createdAt: row.created_at,
  };
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

    const communications = ((data ?? []) as unknown[])
      .map((row) => dbToCommunication(asCommunicationRow(row)));

    return NextResponse.json({ ok: true, communications, count: communications.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'communications_query_failed' }, { status: 500 });
  }
}
