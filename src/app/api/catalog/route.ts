// Service catalog — list + create (redesign P4). Backs Settings → Κατάλογος and
// the offer composer's auto-suggest. Table: public.service_catalog_items (040).
// Business isolation: authenticated member RLS + explicit business_id scope.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function nonNegNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) && n >= 0 ? n : fallback;
}

interface CatalogRow {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  unit_price: number;
  vat_rate: number;
  active: boolean;
  source: string;
  created_at: string;
}

function dbToItem(r: CatalogRow) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    category: r.category,
    unit: r.unit,
    unitPrice: r.unit_price,
    vatRate: r.vat_rate,
    active: r.active,
    source: r.source,
    createdAt: r.created_at,
  };
}

const COLUMNS = 'id, code, name, description, category, unit, unit_price, vat_rate, active, source, created_at';

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) {
    if (auth.error.status === 404) return NextResponse.json({ ok: true, items: [] });
    return auth.error;
  }
  const { supabase, businessId } = auth.ctx;

  const { searchParams } = request.nextUrl;
  const q = (searchParams.get('q') ?? '').trim().replace(/[%,()]/g, '');
  const category = str(searchParams.get('category'));
  const includeInactive = searchParams.get('all') === '1';

  let query = supabase
    .from('service_catalog_items')
    .select(COLUMNS)
    .eq('business_id', businessId)
    .order('name', { ascending: true })
    .limit(500);

  if (!includeInactive) query = query.eq('active', true);
  if (category) query = query.eq('category', category);
  if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: 'catalog_query_failed' }, { status: 500 });
  }
  const items = ((data ?? []) as unknown[]).map((r) => dbToItem(r as CatalogRow));
  return NextResponse.json({ ok: true, items });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId, userId } = auth.ctx;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const name = str(raw.name);
  if (!name) return NextResponse.json({ ok: false, error: 'invalid_name' }, { status: 400 });

  const sourceRaw = str(raw.source);
  const source = sourceRaw && ['manual', 'ai_chat', 'file_import'].includes(sourceRaw) ? sourceRaw : 'manual';

  const { data, error } = await supabase
    .from('service_catalog_items')
    .insert({
      business_id: businessId,
      code: str(raw.code),
      name,
      description: str(raw.description),
      category: str(raw.category),
      unit: str(raw.unit),
      unit_price: nonNegNumber(raw.unitPrice, 0),
      vat_rate: nonNegNumber(raw.vatRate, 24),
      active: raw.active === false ? false : true,
      source,
      created_by: userId,
      updated_at: new Date().toISOString(),
    })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    // Unique (business_id, lower(code)) violation → friendly message.
    const dup = typeof error?.code === 'string' && error.code === '23505';
    return NextResponse.json({ ok: false, error: dup ? 'duplicate_code' : 'catalog_create_failed' }, { status: dup ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, item: dbToItem(data as unknown as CatalogRow) }, { status: 201 });
}
