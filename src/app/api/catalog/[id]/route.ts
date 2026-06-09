// Service catalog item — update + (soft) delete (redesign P4).
// Business isolation: authenticated member RLS + explicit business_id scope.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function nonNegNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

const COLUMNS = 'id, code, name, description, category, unit, unit_price, vat_rate, active, source, created_at';

interface CatalogRow {
  id: string; code: string | null; name: string; description: string | null;
  category: string | null; unit: string | null; unit_price: number; vat_rate: number;
  active: boolean; source: string; created_at: string;
}

function dbToItem(r: CatalogRow) {
  return {
    id: r.id, code: r.code, name: r.name, description: r.description, category: r.category,
    unit: r.unit, unitPrice: r.unit_price, vatRate: r.vat_rate, active: r.active,
    source: r.source, createdAt: r.created_at,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if ('code' in raw) update.code = str(raw.code);
  if ('name' in raw) { const n = str(raw.name); if (!n) return NextResponse.json({ ok: false, error: 'invalid_name' }, { status: 400 }); update.name = n; }
  if ('description' in raw) update.description = str(raw.description);
  if ('category' in raw) update.category = str(raw.category);
  if ('unit' in raw) update.unit = str(raw.unit);
  if ('unitPrice' in raw) { const p = nonNegNumber(raw.unitPrice); if (p !== null) update.unit_price = p; }
  if ('vatRate' in raw) { const v = nonNegNumber(raw.vatRate); if (v !== null) update.vat_rate = v; }
  if ('active' in raw) update.active = raw.active === true;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'no_fields' }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('service_catalog_items')
    .update(update)
    .eq('id', id)
    .eq('business_id', businessId)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    const dup = typeof error.code === 'string' && error.code === '23505';
    return NextResponse.json({ ok: false, error: dup ? 'duplicate_code' : 'catalog_update_failed' }, { status: dup ? 409 : 500 });
  }
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, item: dbToItem(data as unknown as CatalogRow) });
}

// Soft-delete: mark inactive (keeps historical offer references intact).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id } = await params;

  const { error } = await supabase
    .from('service_catalog_items')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', businessId);

  if (error) return NextResponse.json({ ok: false, error: 'catalog_delete_failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
