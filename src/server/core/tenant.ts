// Tenant-safe database access.
//
// PR-1 foundation: ADDITIVE, imported by no live route yet → zero runtime change.
//
// The whole app talks to Postgres through the Supabase SERVICE-ROLE client, which
// BYPASSES Row Level Security. Today every route must remember to add
// `.eq('business_id', businessId)` by hand on every query — a single omission would
// cross tenants (this is the #1 architectural risk in the overview). `tenantDb`
// removes that footgun: the business_id filter (and, on insert, the business_id
// column) is applied for you, while you keep the normal PostgREST builder so you
// can still chain `.order` / `.in` / `.or` / `.single` / `.range` / ...
//
//   const db = tenantDb(ctx.supabase, ctx.businessId);
//   const { data } = await db.from('customers').select('*').order('created_at', { ascending: false });
//   const { data } = await db.from('customers').byId(id, 'id, name').single();
//   const { data } = await db.from('customers').insert({ name }).select('*').single();
//   await db.from('customers').update({ pinned: true }).eq('id', id);
//   await db.from('customers').delete().eq('id', id);
//
// Note: the strongest guarantee is to enforce isolation at the DB with RLS + the
// caller's JWT (reserving the service-role key for genuinely cross-tenant ops).
// This wrapper is the pragmatic 80% for the current service-role architecture —
// see docs/ARCHITECTURE_REFACTOR_PLAN.md (§ "north star: lean on RLS").

import type { createServerSupabaseClient } from '../../lib/supabase/server';

type ServiceClient = ReturnType<typeof createServerSupabaseClient>;

export interface TenantContext {
  userId: string;
  businessId: string;
  /** 'owner' | 'admin' | 'member' */
  role: string;
}

/**
 * Returns a thin builder over the service-role client that auto-scopes every
 * query to `businessId`. The returned `.select/.byId/.insert/.update/.delete`
 * hand back the NATIVE PostgREST builder, so all further chaining is unchanged.
 */
export function tenantDb(client: ServiceClient, businessId: string) {
  return {
    from(table: string) {
      const base = () => client.from(table);
      return {
        /** SELECT scoped to this tenant. Chain `.order/.in/.or/.single/...` as usual. */
        select: (columns = '*') => base().select(columns).eq('business_id', businessId),
        /** SELECT one tenant row by id (chain `.single()`). */
        byId: (id: string, columns = '*') =>
          base().select(columns).eq('business_id', businessId).eq('id', id),
        /** INSERT with business_id injected, so a row can never be mis-tenanted. */
        insert: (values: Record<string, unknown> | Record<string, unknown>[]) =>
          base().insert(
            Array.isArray(values)
              ? values.map((v) => ({ ...v, business_id: businessId }))
              : { ...values, business_id: businessId },
          ),
        /** UPDATE scoped to this tenant (chain `.eq('id', id)` for a single row). */
        update: (values: Record<string, unknown>) =>
          base().update(values).eq('business_id', businessId),
        /** DELETE scoped to this tenant (chain `.eq('id', id)` for a single row). */
        delete: () => base().delete().eq('business_id', businessId),
      };
    },
  };
}

export type TenantDb = ReturnType<typeof tenantDb>;
