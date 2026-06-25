// Customers — repository (data access only), reference module, PR-1.
//
// Every query goes through `tenantDb`, so the business_id filter is structurally
// guaranteed and can't be forgotten. This is the ONLY layer that touches Supabase.
//
// NOTE: the live route also carries migration-tolerant fallbacks (pre-044 `pinned`
// ordering, pre-053 `imported_from_phone`). Those are intentionally omitted from
// this reference cut for clarity; the production migration (PR-2) folds them back
// in unchanged. This module is imported by no live route yet.

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { CUSTOMER_COLUMNS, type CustomerRow, type CustomerDetailRow } from './customers.types';
import type { ListCustomersQuery } from './customers.schema';

/** A resolved request context carrying the service-role client + tenant. */
export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export async function listCustomerRows(
  ctx: RepoContext,
  query: ListCustomersQuery,
): Promise<CustomerRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  let qb = db.from('customers').select(CUSTOMER_COLUMNS);

  if (query.status) qb = qb.eq('status', query.status);
  if (query.awaiting) qb = qb.is('name', null).eq('source', 'inbound_call');
  if (query.q) {
    // Strip PostgREST .or()/LIKE metacharacters so a Greek term with a comma,
    // parens, % or * can't corrupt the filter or inject extra .or conditions.
    const q = query.q.replace(/[%,()*\\]/g, '').trim();
    if (q) {
      qb = qb.or(
        `name.ilike.%${q}%,company_name.ilike.%${q}%,phone.ilike.%${q}%,mobile_phone.ilike.%${q}%,email.ilike.%${q}%`,
      );
    }
  }

  qb = query.sort === 'name'
    ? qb.order('name', { ascending: true, nullsFirst: false })
    : qb.order('created_at', { ascending: false });

  qb = qb.range(query.offset, query.offset + query.limit - 1);

  const { data, error } = await qb;
  if (error) throw new AppError('customers_query_failed', 500);
  return ((data ?? []) as unknown[]).map((r) => r as CustomerRow);
}

export async function getCustomerRowById(
  ctx: RepoContext,
  id: string,
): Promise<CustomerRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('customers').byId(id, CUSTOMER_COLUMNS).single();
  if (error || !data) return null;
  return data as unknown as CustomerRow;
}

export async function insertCustomerRow(
  ctx: RepoContext,
  values: Record<string, unknown>,
): Promise<CustomerRow> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('customers')
    .insert(values)
    .select(CUSTOMER_COLUMNS)
    .single();
  if (error || !data) throw new AppError('customer_create_failed', 500);
  return data as unknown as CustomerRow;
}

// --- single-customer reads/writes for /api/customers/[id] (GET/PATCH/DELETE) ---

/** Fetch one customer by id (GET). DB error → customer_query_failed; null when no row. */
export async function getCustomerDetailRow(ctx: RepoContext, id: string): Promise<CustomerDetailRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('customers').byId(id, CUSTOMER_COLUMNS).maybeSingle();
  if (error) throw new AppError('customer_query_failed', 500);
  return (data as unknown as CustomerDetailRow) ?? null;
}

/** Fetch one customer by id on the no-field-change PATCH path. DB error → customer_update_failed; null when no row. */
export async function fetchCustomerRowForUpdate(ctx: RepoContext, id: string): Promise<CustomerDetailRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('customers').byId(id, CUSTOMER_COLUMNS).maybeSingle();
  if (error) throw new AppError('customer_update_failed', 500);
  return (data as unknown as CustomerDetailRow) ?? null;
}

/** Apply the core partial update to one customer. DB error → customer_update_failed; null when no row. */
export async function updateCustomerRow(
  ctx: RepoContext,
  id: string,
  fields: Record<string, unknown>,
): Promise<CustomerDetailRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('customers')
    .update(fields)
    .eq('id', id)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle();
  if (error) throw new AppError('customer_update_failed', 500);
  return (data as unknown as CustomerDetailRow) ?? null;
}

/** Tolerant pin read (pre-044 → undefined). Returns the value only when the row resolves. */
export async function fetchCustomerPinned(ctx: RepoContext, id: string): Promise<boolean | undefined> {
  try {
    const db = tenantDb(ctx.supabase, ctx.businessId);
    const { data, error } = await db.from('customers').byId(id, 'pinned').maybeSingle();
    if (!error && data) return (data as { pinned?: boolean }).pinned ?? false;
  } catch {
    // pre-044 → leave the default
  }
  return undefined;
}

/** Tolerant 053 extras read (postal_code / region / imported_from_phone). */
export async function fetchCustomerExtras(
  ctx: RepoContext,
  id: string,
): Promise<{ postalCode: string | null; region: string | null; importedFromPhone: boolean } | undefined> {
  try {
    const db = tenantDb(ctx.supabase, ctx.businessId);
    const { data, error } = await db
      .from('customers')
      .byId(id, 'postal_code, region, imported_from_phone')
      .maybeSingle();
    if (!error && data) {
      const r = data as unknown as { postal_code: string | null; region: string | null; imported_from_phone: boolean | null };
      return { postalCode: r.postal_code ?? null, region: r.region ?? null, importedFromPhone: r.imported_from_phone ?? false };
    }
  } catch {
    // pre-053 → leave the defaults
  }
  return undefined;
}

/** Tolerant 058 blocked read. */
export async function fetchCustomerBlocked(ctx: RepoContext, id: string): Promise<boolean | undefined> {
  try {
    const db = tenantDb(ctx.supabase, ctx.businessId);
    const { data, error } = await db.from('customers').byId(id, 'blocked').maybeSingle();
    if (!error && data) return (data as unknown as { blocked: boolean | null }).blocked ?? false;
  } catch {
    // pre-058 → leave the default
  }
  return undefined;
}

/** Isolated 053 extras write — returns whether the write succeeded (pre-053 column-missing → false). */
export async function applyCustomerExtras(
  ctx: RepoContext,
  id: string,
  extra: Record<string, unknown>,
): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error } = await db.from('customers').update(extra).eq('id', id);
  return !error;
}

/** Isolated 058 blocked write — returns whether the write succeeded (pre-058 → false). */
export async function applyCustomerBlocked(ctx: RepoContext, id: string, blocked: boolean): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error } = await db.from('customers').update({ blocked }).eq('id', id);
  return !error;
}

/** Hard-delete one customer (any kind). DB error → customer_delete_failed; returns the deleted count. */
export async function deleteCustomerRow(ctx: RepoContext, id: string): Promise<number> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('customers').delete().eq('id', id).select('id');
  if (error) throw new AppError('customer_delete_failed', 500);
  return Array.isArray(data) ? data.length : 0;
}

/** pre-053 tolerance: a missing `imported_from_phone` column → degrade, don't 500. */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('imported_from_phone') || (msg.includes('column') && msg.includes('does not exist'));
}

/** Hard-delete EVERY contact for this tenant (child rows handled by schema FKs). */
export async function deleteAllCustomerRows(ctx: RepoContext): Promise<{ deleted: number }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('customers').delete().select('id');
  if (error) throw new AppError('delete_failed', 500);
  return { deleted: Array.isArray(data) ? data.length : 0 };
}

/**
 * Hard-delete only phone-imported contacts. On a pre-053 schema (no
 * `imported_from_phone` column) returns `{ columnMissing: true }` so the route can
 * tell the UI to use «Διαγραφή όλων» instead — rather than 500.
 */
export async function deleteImportedCustomerRows(
  ctx: RepoContext,
): Promise<{ deleted: number } | { columnMissing: true }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('customers')
    .delete()
    .eq('imported_from_phone', true)
    .select('id');
  if (error) {
    if (isMissingColumnError(error)) return { columnMissing: true };
    throw new AppError('delete_failed', 500);
  }
  return { deleted: Array.isArray(data) ? data.length : 0 };
}

/** Atomic per-business CRM number (#N), with a legacy scan fallback (pre-043). */
export async function takeNextCrmNumber(ctx: RepoContext): Promise<string> {
  try {
    const { data, error } = await ctx.supabase.rpc('take_next_crm_number', {
      p_business_id: ctx.businessId,
    });
    if (!error && typeof data === 'number' && data > 0) return `#${data}`;
  } catch {
    // pre-043 schema — fall through to the legacy scan
  }

  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('customers').select('crm_number').not('crm_number', 'is', null);
  const rows = (data ?? []) as unknown as Array<{ crm_number: string | null }>;
  const max = rows
    .map((r) => {
      const m = r.crm_number?.match(/(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .reduce((acc, n) => (n > acc ? n : acc), 0);
  return `#${max + 1}`;
}
