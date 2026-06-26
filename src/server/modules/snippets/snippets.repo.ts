// Message snippets — repository (tenant-safe data access).

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import type { SnippetRow } from './snippets.types';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

/** Count this tenant's snippets (used as the next sort_order). */
export async function countSnippets(ctx: RepoContext): Promise<number> {
  const { count } = await ctx.supabase
    .from('message_snippets')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.businessId);
  return count ?? 0;
}

export async function insertSnippetRow(
  ctx: RepoContext,
  values: { title: string; body: string; sortOrder: number },
): Promise<SnippetRow> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('message_snippets')
    .insert({ title: values.title, body: values.body, sort_order: values.sortOrder })
    .select('id, title, body, sort_order')
    .single();
  if (error || !data) throw new AppError('create_failed', 500);
  return data as unknown as SnippetRow;
}

export async function updateSnippetRow(
  ctx: RepoContext,
  id: string,
  updates: Record<string, unknown>,
): Promise<SnippetRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('message_snippets')
    .update(updates)
    .eq('id', id)
    .select('id, title, body, sort_order')
    .maybeSingle();
  if (error) throw new AppError('update_failed', 500);
  return (data as unknown as SnippetRow) ?? null;
}

export async function deleteSnippetRow(ctx: RepoContext, id: string): Promise<void> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error } = await db.from('message_snippets').delete().eq('id', id);
  if (error) throw new AppError('delete_failed', 500);
}
