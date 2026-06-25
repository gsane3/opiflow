// Service catalog — repository (tenant-safe data access).

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { CATALOG_COLUMNS, type CatalogRow } from './catalog.types';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export interface ListCatalogParams {
  q?: string;
  category?: string | null;
  includeInactive?: boolean;
}

export async function listCatalogRows(
  ctx: RepoContext,
  params: ListCatalogParams,
): Promise<CatalogRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  let qb = db.from('service_catalog_items').select(CATALOG_COLUMNS).order('name', { ascending: true }).limit(500);
  if (!params.includeInactive) qb = qb.eq('active', true);
  if (params.category) qb = qb.eq('category', params.category);
  if (params.q) qb = qb.or(`name.ilike.%${params.q}%,code.ilike.%${params.q}%`);

  const { data, error } = await qb;
  if (error) throw new AppError('catalog_query_failed', 500);
  return ((data ?? []) as unknown[]).map((r) => r as CatalogRow);
}

export async function insertCatalogRow(
  ctx: RepoContext,
  values: Record<string, unknown>,
): Promise<CatalogRow> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('service_catalog_items')
    .insert(values)
    .select(CATALOG_COLUMNS)
    .single();
  if (error || !data) {
    // Unique (business_id, lower(code)) violation → friendly 409, else 500.
    const dup = (error as { code?: string } | null)?.code === '23505';
    throw new AppError(dup ? 'duplicate_code' : 'catalog_create_failed', dup ? 409 : 500);
  }
  return data as unknown as CatalogRow;
}
