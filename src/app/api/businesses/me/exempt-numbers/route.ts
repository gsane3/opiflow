// /api/businesses/me/exempt-numbers
//
// Per-business call EXEMPTION list (#9): numbers that must NOT hear the
// «η κλήση ηχογραφείται» disclosure and must NOT be recorded (the owner's personal
// contacts). Stored in public.business_exempt_numbers as last-10 normalized digits,
// decoupled from the CRM. The inbound/outbound call path checks this list before
// playing the disclosure / starting recording.
//
//   GET    → { ok, numbers: [{ phone, label }], migrationPending? }
//   POST   → body { numbers: [{ phone, label? }] } | { phone, label? }  → upserts; { ok, added }
//   DELETE → body { phone }                                             → { ok, removed }
//
// Business-scoped (owner) via Bearer + resolveBusinessContext. TOLERANT of the table
// being absent (migration 060 not applied) → degrades cleanly to an empty list.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBusinessContext } from '@/lib/api/auth';

export const runtime = 'nodejs';

// Cap the list so a runaway "select all contacts" can't insert unbounded rows.
const MAX_NUMBERS = 2000;

const last10 = (s: unknown): string => (typeof s === 'string' ? s.replace(/\D/g, '').slice(-10) : '');

/** Treat a PostgREST "relation missing" error as "migration 060 not applied yet". */
function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const m = (err.message ?? '').toLowerCase();
  return err.code === '42P01' || err.code === 'PGRST205' || m.includes('business_exempt_numbers');
}

async function authBusiness(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 }) };
  }
  const token = authHeader.slice(7);
  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 }) };
  }
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { error: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) };
  }
  const resolved = await resolveBusinessContext(supabase, user.id);
  if (!resolved) {
    return { error: NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 }) };
  }
  return { supabase, businessId: resolved.businessId };
}

export async function GET(request: NextRequest) {
  const a = await authBusiness(request);
  if ('error' in a) return a.error;
  try {
    const { data, error } = await a.supabase
      .from('business_exempt_numbers')
      .select('phone, label')
      .eq('business_id', a.businessId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ok: true, numbers: [], migrationPending: true });
      return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, numbers: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const a = await authBusiness(request);
  if ('error' in a) return a.error;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });

  // Accept a single {phone,label} or a batch {numbers:[...]} (the select-all picker).
  const b = body as Record<string, unknown>;
  const rawList = Array.isArray(b.numbers) ? b.numbers : [b];
  const seen = new Set<string>();
  const rows: { business_id: string; phone: string; label: string | null }[] = [];
  for (const item of rawList) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const phone = last10(rec.phone);
    if (phone.length !== 10 || seen.has(phone)) continue;
    seen.add(phone);
    const labelRaw = typeof rec.label === 'string' ? rec.label.trim() : '';
    rows.push({ business_id: a.businessId, phone, label: labelRaw || null });
    if (rows.length >= MAX_NUMBERS) break;
  }
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'no_valid_numbers' }, { status: 400 });

  try {
    const { error } = await a.supabase
      .from('business_exempt_numbers')
      .upsert(rows, { onConflict: 'business_id,phone', ignoreDuplicates: true });
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ok: false, error: 'migration_pending' }, { status: 503 });
      return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, added: rows.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const a = await authBusiness(request);
  if ('error' in a) return a.error;

  // Phone may arrive as a ?phone= query param (the native apiDelete sends no body)
  // or in a JSON body. Query param takes precedence.
  let phone = last10(request.nextUrl.searchParams.get('phone'));
  if (phone.length !== 10) {
    try {
      const body = await request.json();
      phone = last10((body as Record<string, unknown> | null)?.phone);
    } catch { /* no body — fall through to the validation below */ }
  }
  if (phone.length !== 10) return NextResponse.json({ ok: false, error: 'invalid_phone' }, { status: 400 });

  try {
    const { error } = await a.supabase
      .from('business_exempt_numbers')
      .delete()
      .eq('business_id', a.businessId)
      .eq('phone', phone);
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ok: true, removed: 0, migrationPending: true });
      return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, removed: 1 });
  } catch {
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }
}
