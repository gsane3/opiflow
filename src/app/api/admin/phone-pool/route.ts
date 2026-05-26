import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// E.164 validation: starts with +, followed by 8 to 15 digits.
const E164_RE = /^\+\d{8,15}$/;

const ALLOWED_PROVIDERS = ['intertelecom'] as const;

type PoolRow = {
  id: string;
  e164_number: string;
  provider: string;
  status: string;
  imported_at: string;
  assigned_at: string | null;
  retired_at: string | null;
};

type StatsMap = {
  available: number;
  assigned: number;
  reserved: number;
  retired: number;
  total: number;
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
// Fields returned: id, e164_number, provider, status, imported_at,
//   assigned_at, retired_at.
// provider_ref and notes are intentionally excluded.

export async function GET(request: NextRequest) {
  const guard = await checkAdmin(request);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  try {
    const { data, error } = await supabase
      .from('managed_phone_numbers')
      .select('id, e164_number, provider, status, imported_at, assigned_at, retired_at')
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
      retired: 0,
      total: rows.length,
    };

    for (const row of rows) {
      if (row.status === 'available') stats.available += 1;
      else if (row.status === 'assigned') stats.assigned += 1;
      else if (row.status === 'reserved') stats.reserved += 1;
      else if (row.status === 'retired') stats.retired += 1;
    }

    return NextResponse.json({ ok: true, stats, numbers: rows });
  } catch {
    return NextResponse.json({ ok: false, error: 'phone_pool_route_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/phone-pool
// ---------------------------------------------------------------------------
// Inserts one new managed_phone_numbers row with status = "available".
// Accepts: { e164_number: string, provider?: string, notes?: string }
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

  try {
    const insertPayload: Record<string, unknown> = {
      e164_number: e164,
      provider,
      status: 'available',
    };
    if (notes !== null) {
      insertPayload['notes'] = notes;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('managed_phone_numbers')
      .insert(insertPayload)
      .select('id, e164_number, provider, status, imported_at, assigned_at, retired_at')
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
