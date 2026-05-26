import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// GET /api/admin/me
// ---------------------------------------------------------------------------
// Validates the caller is the configured admin.
// Returns 200 { ok:true, user:{ id, email } } for admin.
// Returns 401, 403, or 503 on failure.
// ADMIN_USER_ID is never included in any response.

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const adminUserId = process.env.ADMIN_USER_ID;
  if (!adminUserId) {
    return NextResponse.json({ ok: false, error: 'admin_not_configured' }, { status: 503 });
  }

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json(
        { ok: false, error: 'missing_supabase_config' },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'admin_check_failed' },
      { status: 500 }
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
  }

  if (user.id !== adminUserId) {
    return NextResponse.json({ ok: false, error: 'admin_required' }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
  });
}
