// Invoicing — tenant-safe data access for business_invoicing_settings + invoices.

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import type { InvoiceRow, InvoicingSettingsRow } from './types';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

const SETTINGS_COLUMNS =
  'id, business_id, enabled, provider, issuer_vat, issuer_branch, invoice_series, ' +
  'auto_issue_on_payment, default_income_classification, onboarding_status, ' +
  'gsis_authorized_at, activated_at, created_at, updated_at';

const INVOICE_COLUMNS =
  'id, business_id, customer_id, work_folder_id, offer_id, payment_request_id, provider, ' +
  'invoice_type, series, aa, issue_date, counterparty_vat, counterparty_name, currency, ' +
  'net_amount, vat_amount, total_amount, line_items, classification, status, mark, uid, ' +
  'authentication_code, qr_url, cancellation_mark, dedup_key, provider_request, ' +
  'provider_response, error, issued_at, created_at, updated_at';

export async function getInvoicingSettings(ctx: RepoContext): Promise<InvoicingSettingsRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('business_invoicing_settings').select(SETTINGS_COLUMNS).maybeSingle();
  if (error) throw new AppError('invoicing_settings_query_failed', 500);
  return (data as unknown as InvoicingSettingsRow) ?? null;
}

/** Upsert the single per-business settings row (select → update | insert). */
export async function upsertInvoicingSettings(
  ctx: RepoContext,
  fields: Record<string, unknown>
): Promise<InvoicingSettingsRow> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const existing = await getInvoicingSettings(ctx);
  const patch = { ...fields, updated_at: new Date().toISOString() };
  if (existing) {
    const { data, error } = await db
      .from('business_invoicing_settings')
      .update(patch)
      .eq('id', existing.id)
      .select(SETTINGS_COLUMNS)
      .maybeSingle();
    if (error || !data) throw new AppError('invoicing_settings_update_failed', 500);
    return data as unknown as InvoicingSettingsRow;
  }
  const { data, error } = await db
    .from('business_invoicing_settings')
    .insert(patch)
    .select(SETTINGS_COLUMNS)
    .single();
  if (error || !data) throw new AppError('invoicing_settings_update_failed', 500);
  return data as unknown as InvoicingSettingsRow;
}

export interface AddonStatus {
  addon_status: 'none' | 'active' | 'cancelled';
  addon_subscription_id: string | null;
  addon_current_period_end: string | null;
}

/** Tolerant read of the 068 add-on entitlement columns. Returns undefined when the
 *  migration isn't applied yet (column-missing) — NOT in SETTINGS_COLUMNS, so the
 *  core settings fetch + issuance gate are never affected. */
export async function getInvoicingAddonStatus(ctx: RepoContext): Promise<AddonStatus | undefined> {
  try {
    const db = tenantDb(ctx.supabase, ctx.businessId);
    const { data, error } = await db
      .from('business_invoicing_settings')
      .select('addon_status, addon_subscription_id, addon_current_period_end')
      .maybeSingle();
    if (error) return undefined; // pre-068 column-missing (or transient) → degrade
    if (!data) return { addon_status: 'none', addon_subscription_id: null, addon_current_period_end: null };
    const r = data as unknown as Partial<AddonStatus>;
    return {
      addon_status: (r.addon_status as AddonStatus['addon_status']) ?? 'none',
      addon_subscription_id: r.addon_subscription_id ?? null,
      addon_current_period_end: r.addon_current_period_end ?? null,
    };
  } catch {
    return undefined;
  }
}

function isMissingColumnOrTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === '42P01') return true; // undefined_column / undefined_table
  const msg = (error.message ?? '').toLowerCase();
  return (msg.includes('addon_') || msg.includes('business_invoicing_settings')) && msg.includes('does not exist');
}

/** Isolated, tolerant write of the 068 add-on columns (Stripe-webhook driven).
 *  Upserts the per-tenant settings row (the tenant may pay before ever opening
 *  settings). Returns { ok, columnMissing }: columnMissing=true (pre-068) is a
 *  PERMANENT failure the webhook acknowledges (no point retrying); ok=false with
 *  columnMissing=false is transient (→ webhook 500 so Stripe retries). */
export async function applyAddonSubscription(
  ctx: RepoContext,
  fields: Record<string, unknown>
): Promise<{ ok: boolean; columnMissing: boolean }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const patch = { ...fields, updated_at: new Date().toISOString() };
  const { data: existing, error: selErr } = await db
    .from('business_invoicing_settings')
    .select('id')
    .maybeSingle();
  if (selErr) return { ok: false, columnMissing: isMissingColumnOrTable(selErr) };
  const existingId = (existing as unknown as { id?: string } | null)?.id ?? null;
  const { error } = existingId
    ? await db.from('business_invoicing_settings').update(patch).eq('id', existingId)
    : await db.from('business_invoicing_settings').insert(patch);
  if (!error) return { ok: true, columnMissing: false };
  return { ok: false, columnMissing: isMissingColumnOrTable(error as { code?: string; message?: string }) };
}

export async function findInvoiceByDedup(ctx: RepoContext, dedupKey: string): Promise<InvoiceRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('dedup_key', dedupKey)
    .maybeSingle();
  if (error) throw new AppError('invoice_query_failed', 500);
  return (data as unknown as InvoiceRow) ?? null;
}

export async function createInvoice(ctx: RepoContext, fields: Record<string, unknown>): Promise<InvoiceRow> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('invoices').insert(fields).select(INVOICE_COLUMNS).single();
  if (error || !data) throw new AppError('invoice_create_failed', 500);
  return data as unknown as InvoiceRow;
}

export async function updateInvoice(
  ctx: RepoContext,
  id: string,
  fields: Record<string, unknown>
): Promise<InvoiceRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('invoices')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(INVOICE_COLUMNS)
    .maybeSingle();
  if (error) throw new AppError('invoice_update_failed', 500);
  return (data as unknown as InvoiceRow) ?? null;
}

export async function getInvoiceById(ctx: RepoContext, id: string): Promise<InvoiceRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('invoices').byId(id, INVOICE_COLUMNS).maybeSingle();
  if (error) throw new AppError('invoice_query_failed', 500);
  return (data as unknown as InvoiceRow) ?? null;
}

export interface ListInvoicesParams {
  status?: string;
  customerId?: string;
  limit: number;
  offset: number;
}

export async function listInvoices(ctx: RepoContext, query: ListInvoicesParams): Promise<InvoiceRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  let qb = db.from('invoices').select(INVOICE_COLUMNS);
  if (query.status) qb = qb.eq('status', query.status);
  if (query.customerId) qb = qb.eq('customer_id', query.customerId);
  qb = qb.order('created_at', { ascending: false }).range(query.offset, query.offset + query.limit - 1);
  const { data, error } = await qb;
  if (error) throw new AppError('invoice_query_failed', 500);
  return ((data ?? []) as unknown[]).map((r) => r as InvoiceRow);
}

/** Counterparty (end-customer) name + ΑΦΜ for the invoice. The ΑΦΜ (vat_number) is
 *  migration 067, applied MANUALLY — so the select is tolerant: it tries with
 *  vat_number first and falls back to the leaner select if the column is missing
 *  (pre-067 → vatNumber resolves to null, i.e. B2C). */
export async function getCustomerForInvoice(
  ctx: RepoContext,
  customerId: string
): Promise<{ name: string | null; companyName: string | null; vatNumber: string | null } | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  for (const cols of ['name, company_name, vat_number', 'name, company_name']) {
    const { data, error } = await db.from('customers').byId(customerId, cols).maybeSingle();
    if (error) continue; // column missing (pre-067) or transient → try the leaner select
    if (!data) return null;
    const c = data as unknown as { name: string | null; company_name: string | null; vat_number?: string | null };
    return { name: c.name, companyName: c.company_name, vatNumber: c.vat_number ?? null };
  }
  return null;
}
