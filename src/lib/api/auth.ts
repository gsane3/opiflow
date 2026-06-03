// Single source of truth for multi-tenant API authentication.
//
// Every business-scoped API route should resolve its caller through
// authenticateBusinessRequest() instead of re-implementing the
// getBearerToken -> getUser -> getBusinessId dance. This guarantees the
// business_id filter is applied consistently and can't be forgotten.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

export interface BusinessAuthContext {
  supabase: SupabaseServer;
  userId: string;
  businessId: string;
}

export function getBearerToken(request: NextRequest): string | null {
  const h = request.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

/**
 * Resolves the authenticated user and their business.
 * Returns either `{ ctx }` (proceed) or `{ error }` (a ready NextResponse to return).
 *
 * Usage:
 *   const auth = await authenticateBusinessRequest(req);
 *   if ('error' in auth) return auth.error;
 *   const { supabase, businessId } = auth.ctx;
 */
export async function authenticateBusinessRequest(
  request: NextRequest
): Promise<{ ctx: BusinessAuthContext } | { error: NextResponse }> {
  const token = getBearerToken(request);
  if (!token) {
    return { error: NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 }) };
  }

  let supabase: SupabaseServer;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 }) };
  }

  let userId: string;
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return { error: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) };
    }
    userId = user.id;
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) };
  }

  const { data } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  const businessId = (data as { id?: string } | null)?.id ?? null;
  if (!businessId) {
    return { error: NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 }) };
  }

  return { ctx: { supabase, userId, businessId } };
}
