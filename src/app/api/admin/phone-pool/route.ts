import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// E.164 validation: starts with +, followed by 8 to 15 digits.
const E164_RE = /^\+\d{8,15}$/;

// UUID validation: standard 8-4-4-4-12 hyphenated hex format.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_PROVIDERS = ['intertelecom'] as const;

type PoolRow = {
  id: string;
  e164_number: string;
  provider: string;
  city: string | null;
  number_type: string | null;
  status: string;
  imported_at: string;
  assigned_at: string | null;
  cooling_down_since: string | null;
  available_after: string | null;
  retired_at: string | null;
};

// Safe assignment metadata merged into each pool row in GET.
// Only business_id and name are included. No email, phone, vat, owner_id,
// address, notes, or provider_ref are queried or returned.
type AssignmentMeta = {
  assigned_business_id:   string | null;
  assigned_business_name: string | null;
  assignment_status:      string | null;
};

type PoolRowEnriched = PoolRow & AssignmentMeta;

type StatsMap = {
  available: number;
  assigned: number;
  reserved: number;
  suspended: number;
  cooling_down: number;
  retired: number;
  total: number;
  by_city: Record<string, number>;
  by_type: Record<string, number>;
  pendingNumberRequests: number;
};

// Safe shape returned per pending number request in the admin GET.
// provider_reference, notes, and sensitive business fields are excluded.
type PendingNumberRequest = {
  request_id:     string;
  business_id:    string;
  business_name:  string | null;
  business_city:  string | null;
  requested_city: string | null;
  source:         string;
  status:         string;
  created_at:     string;
};

// ---------------------------------------------------------------------------
// Shared auth guard
// ---------------------------------------------------------------------------
// Checks Bearer token, validates Supabase auth user, and compares user.id
// to ADMIN_USER_ID env var. Returns the authenticated supabase client on
// success, or a ready-made NextResponse on failure.
// ADMIN_USER_ID is never included in any response.

async function checkAdmin(request: NextRequest): Promise<
  | { ok: true; supabase: ReturnType<typeof createServerSupabaseClient> }
  | { ok: false; response: NextResponse }
> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 }),
    };
  }
  const token = authHeader.slice(7);

  const adminUserId = process.env.ADMIN_USER_ID;
  if (!adminUserId) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'admin_not_configured' }, { status: 503 }),
    };
  }

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: 'missing_supabase_config' },
          { status: 503 }
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'phone_pool_route_failed' },
        { status: 500 }
      ),
    };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }),
    };
  }

  if (user.id !== adminUserId) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, supabase };
}

// ---------------------------------------------------------------------------
// GET /api/admin/phone-pool
// ---------------------------------------------------------------------------
// Returns pool stats and the most recent 200 managed_phone_numbers rows.
// Fields returned per number: id, e164_number, provider, city, number_type,
//   status, imported_at, assigned_at, cooling_down_since, available_after,
//   retired_at, assigned_business_id, assigned_business_name, assignment_status.
// provider_ref, notes, and all sensitive business fields are intentionally excluded.

export async function GET(request: NextRequest) {
  const guard = await checkAdmin(request);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  try {
    const { data, error } = await supabase
      .from('managed_phone_numbers')
      .select('id, e164_number, provider, city, number_type, status, imported_at, assigned_at, cooling_down_since, available_after, retired_at')
      .order('imported_at', { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ ok: false, error: 'pool_query_failed' }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as PoolRow[];

    const stats: StatsMap = {
      available: 0,
      assigned: 0,
      reserved: 0,
      suspended: 0,
      cooling_down: 0,
      retired: 0,
      total: rows.length,
      by_city: {},
      by_type: {},
      pendingNumberRequests: 0,
    };

    for (const row of rows) {
      if (row.status === 'available') stats.available += 1;
      else if (row.status === 'assigned') stats.assigned += 1;
      else if (row.status === 'reserved') stats.reserved += 1;
      else if (row.status === 'suspended') stats.suspended += 1;
      else if (row.status === 'cooling_down') stats.cooling_down += 1;
      else if (row.status === 'retired') stats.retired += 1;

      // Count all numbers per city for inventory planning.
      // Empty string key represents numbers with no city set.
      const cityKey = row.city ?? '';
      stats.by_city[cityKey] = (stats.by_city[cityKey] ?? 0) + 1;

      // Count by number_type for lifecycle distribution visibility.
      const typeKey = row.number_type ?? 'unknown';
      stats.by_type[typeKey] = (stats.by_type[typeKey] ?? 0) + 1;
    }

    // -----------------------------------------------------------------------
    // Business assignment metadata enrichment
    // -----------------------------------------------------------------------
    // Two separate queries to attach safe assignment metadata to each row.
    // Only business_id and name are fetched from business_phone_numbers /
    // businesses. No sensitive business fields are queried.
    // If either enrichment query fails the full GET returns 500 immediately.

    const enrichedRows: PoolRowEnriched[] = rows.map((r) => ({
      ...r,
      assigned_business_id:   null,
      assigned_business_name: null,
      assignment_status:      null,
    }));

    if (rows.length > 0) {
      const mpnIds = rows.map((r) => r.id);

      // Step 1: fetch active business_phone_numbers rows for this batch.
      const { data: assignments, error: assignError } = await supabase
        .from('business_phone_numbers')
        .select('managed_phone_number_id, business_id, status')
        .in('managed_phone_number_id', mpnIds)
        .eq('status', 'active');

      if (assignError) {
        return NextResponse.json({ ok: false, error: 'pool_query_failed' }, { status: 500 });
      }

      const assignmentRows = (assignments ?? []) as Array<{
        managed_phone_number_id: string;
        business_id: string;
        status: string;
      }>;

      if (assignmentRows.length > 0) {
        // Build mpnId -> { business_id, status } lookup.
        const assignMap = new Map<string, { business_id: string; status: string }>();
        for (const a of assignmentRows) {
          assignMap.set(a.managed_phone_number_id, {
            business_id: a.business_id,
            status:      a.status,
          });
        }

        // Step 2: fetch id + name for the assigned businesses only.
        const businessIds = [...new Set(assignmentRows.map((a) => a.business_id))];

        const { data: businessData, error: bizError } = await supabase
          .from('businesses')
          .select('id, name')
          .in('id', businessIds);

        if (bizError) {
          return NextResponse.json({ ok: false, error: 'pool_query_failed' }, { status: 500 });
        }

        const bizRows = (businessData ?? []) as Array<{ id: string; name: string }>;
        const bizMap = new Map<string, string>();
        for (const b of bizRows) {
          bizMap.set(b.id, b.name);
        }

        // Merge into enriched rows.
        for (const row of enrichedRows) {
          const assignment = assignMap.get(row.id);
          if (assignment) {
            row.assigned_business_id   = assignment.business_id;
            row.assigned_business_name = bizMap.get(assignment.business_id) ?? null;
            row.assignment_status      = assignment.status;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Pending phone number requests
    // -----------------------------------------------------------------------
    // Queries phone_number_requests with status = 'pending', enriched with
    // safe business metadata (id, name, city only). Non-fatal: a query failure
    // returns an empty array and sets pendingRequestsError in the response
    // rather than failing the entire admin GET.

    let pendingNumberRequests: PendingNumberRequest[] = [];
    let pendingRequestsError: string | null = null;

    try {
      const { data: pendingRows, error: pendingQueryError } = await supabase
        .from('phone_number_requests')
        .select('id, business_id, requested_city, source, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(100);

      if (pendingQueryError) {
        pendingRequestsError = 'pending_requests_query_failed';
      } else {
        const prRows = (pendingRows ?? []) as Array<{
          id:             string;
          business_id:    string;
          requested_city: string | null;
          source:         string;
          status:         string;
          created_at:     string;
        }>;

        if (prRows.length > 0) {
          const prBizIds = [...new Set(prRows.map((r) => r.business_id))];

          const { data: prBizData, error: prBizQueryError } = await supabase
            .from('businesses')
            .select('id, name, city')
            .in('id', prBizIds);

          const prBizMap = new Map<string, { name: string | null; city: string | null }>();
          if (!prBizQueryError && prBizData) {
            for (const b of prBizData as Array<{ id: string; name: string | null; city: string | null }>) {
              prBizMap.set(b.id, { name: b.name ?? null, city: b.city ?? null });
            }
          }

          pendingNumberRequests = prRows.map((r) => {
            const biz = prBizMap.get(r.business_id);
            return {
              request_id:     r.id,
              business_id:    r.business_id,
              business_name:  biz?.name ?? null,
              business_city:  biz?.city ?? null,
              requested_city: r.requested_city,
              source:         r.source,
              status:         r.status,
              created_at:     r.created_at,
            };
          });
        }
      }
    } catch {
      pendingRequestsError = 'pending_requests_query_failed';
    }

    stats.pendingNumberRequests = pendingNumberRequests.length;

    return NextResponse.json({
      ok: true,
      stats,
      numbers: enrichedRows,
      pendingNumberRequests,
      ...(pendingRequestsError !== null ? { pendingRequestsError } : {}),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'phone_pool_route_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/phone-pool
// ---------------------------------------------------------------------------
// Inserts one new managed_phone_numbers row with status = "available".
// Accepts: { e164_number: string, provider?: string, city?: string, notes?: string }
// Returns safe row metadata. provider_ref and notes are not returned.

export async function POST(request: NextRequest) {
  const guard = await checkAdmin(request);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // Validate e164_number
  const rawE164 = raw['e164_number'];
  if (typeof rawE164 !== 'string') {
    return NextResponse.json({ ok: false, error: 'invalid_e164' }, { status: 400 });
  }
  const e164 = rawE164.trim();
  if (!E164_RE.test(e164)) {
    return NextResponse.json({ ok: false, error: 'invalid_e164' }, { status: 400 });
  }

  // Validate provider (defaults to intertelecom)
  const rawProvider = raw['provider'];
  const provider: string =
    rawProvider === undefined || rawProvider === null
      ? 'intertelecom'
      : String(rawProvider).trim();

  if (!(ALLOWED_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json({ ok: false, error: 'invalid_provider' }, { status: 400 });
  }

  // Validate notes (optional, max 500 chars)
  let notes: string | null = null;
  const rawNotes = raw['notes'];
  if (rawNotes !== undefined && rawNotes !== null) {
    if (typeof rawNotes !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_notes' }, { status: 400 });
    }
    const trimmedNotes = rawNotes.trim();
    if (trimmedNotes.length > 500) {
      return NextResponse.json({ ok: false, error: 'invalid_notes' }, { status: 400 });
    }
    notes = trimmedNotes.length > 0 ? trimmedNotes : null;
  }

  // Validate city (optional, max 100 chars)
  let city: string | null = null;
  const rawCity = raw['city'];
  if (rawCity !== undefined && rawCity !== null) {
    if (typeof rawCity !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_city' }, { status: 400 });
    }
    const trimmedCity = rawCity.trim();
    if (trimmedCity.length > 100) {
      return NextResponse.json({ ok: false, error: 'invalid_city' }, { status: 400 });
    }
    city = trimmedCity.length > 0 ? trimmedCity : null;
  }

  try {
    const insertPayload: Record<string, unknown> = {
      e164_number: e164,
      provider,
      status: 'available',
    };
    if (city !== null) {
      insertPayload['city'] = city;
    }
    if (notes !== null) {
      insertPayload['notes'] = notes;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('managed_phone_numbers')
      .insert(insertPayload)
      .select('id, e164_number, provider, city, number_type, status, imported_at, assigned_at, cooling_down_since, available_after, retired_at')
      .single();

    if (insertError) {
      // Postgres unique violation code is 23505.
      if (
        insertError.code === '23505' ||
        insertError.message?.toLowerCase().includes('unique')
      ) {
        return NextResponse.json({ ok: false, error: 'duplicate_number' }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: 'pool_insert_failed' }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, number: inserted as PoolRow },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ ok: false, error: 'phone_pool_route_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/phone-pool
// ---------------------------------------------------------------------------
// Releases a business phone number by calling the release_business_phone_number
// RPC. platform_owned numbers enter 18-month cooldown. customer_ported numbers
// are released without platform cooldown.
// Accepts: { business_id: string, release_reason?: string }
// Does NOT return the e164_number from the RPC result. Returns released boolean,
// managed_phone_number_id, and available_after (null for customer_ported).

export async function PATCH(request: NextRequest) {
  const guard = await checkAdmin(request);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // Validate business_id: required, must be a UUID.
  const rawBusinessId = raw['business_id'];
  if (typeof rawBusinessId !== 'string') {
    return NextResponse.json({ ok: false, error: 'missing_business_id' }, { status: 400 });
  }
  const businessId = rawBusinessId.trim();
  if (!UUID_RE.test(businessId)) {
    return NextResponse.json({ ok: false, error: 'invalid_business_id' }, { status: 400 });
  }

  // Validate release_reason: optional, trimmed, capped at 100 chars, defaults to "cancelled".
  let releaseReason = 'cancelled';
  const rawReason = raw['release_reason'];
  if (rawReason !== undefined && rawReason !== null) {
    if (typeof rawReason !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_release_reason' }, { status: 400 });
    }
    const trimmed = rawReason.trim();
    if (trimmed.length > 100) {
      return NextResponse.json({ ok: false, error: 'invalid_release_reason' }, { status: 400 });
    }
    releaseReason = trimmed.length > 0 ? trimmed : 'cancelled';
  }

  try {
    const { data, error: rpcError } = await supabase.rpc('release_business_phone_number', {
      p_business_id:    businessId,
      p_release_reason: releaseReason,
    });

    if (rpcError) {
      return NextResponse.json({ ok: false, error: 'release_rpc_failed' }, { status: 500 });
    }

    // RETURNS TABLE from Postgres comes back as an array of rows via Supabase JS.
    const rows = data as unknown as Array<{
      released:                boolean;
      managed_phone_number_id: string | null;
      e164_number:             string | null;
      available_after:         string | null;
    }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'release_rpc_failed' }, { status: 500 });
    }

    const row = rows[0];

    // e164_number is intentionally not forwarded to the caller.
    return NextResponse.json({
      ok:                      true,
      released:                row.released === true,
      managed_phone_number_id: row.managed_phone_number_id ?? null,
      available_after:         row.available_after ?? null,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'phone_pool_route_failed' }, { status: 500 });
  }
}
