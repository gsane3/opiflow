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
// ADOPTED to the modular pattern (src/server/modules/exempt-numbers): the table logic
// (list / upsert / delete + migration-060-absent tolerance) lives in the service; the
// route keeps its bespoke `authBusiness` VERBATIM (its getUser is intentionally NOT
// wrapped so a throw → query_failed/insert_failed/delete_failed 500, NOT 401 — a
// deliberate edge contract), parses/validates the body, and maps the service result to
// the exact byte-identical responses.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBusinessContext } from '@/lib/api/auth';
import {
  MAX_NUMBERS,
  last10,
  listExemptNumbers,
  upsertExemptNumbers,
  deleteExemptNumber,
} from '@/server/modules/exempt-numbers/exempt-numbers.service';

export const runtime = 'nodejs';

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
    const result = await listExemptNumbers(a.supabase, a.businessId);
    if (result.kind === 'missing_table') return NextResponse.json({ ok: true, numbers: [], migrationPending: true });
    if (result.kind === 'error') return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
    return NextResponse.json({ ok: true, numbers: result.numbers });
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
    const result = await upsertExemptNumbers(a.supabase, rows);
    if (result.kind === 'missing_table') return NextResponse.json({ ok: false, error: 'migration_pending' }, { status: 503 });
    if (result.kind === 'error') return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 });
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
    const result = await deleteExemptNumber(a.supabase, a.businessId, phone);
    if (result.kind === 'missing_table') return NextResponse.json({ ok: true, removed: 0, migrationPending: true });
    if (result.kind === 'error') return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
    return NextResponse.json({ ok: true, removed: 1 });
  } catch {
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }
}
