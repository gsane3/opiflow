import { describe, it, expect } from 'vitest';
import { createBusinessForOwner, type CreateBusinessDeps } from '../businesses-create';
import type { createServerSupabaseClient } from '../../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;
type Res = { data?: unknown; error?: unknown };
type Op = [string, unknown[]];

function fakeSupabase(resolve: (table: string, ops: Op[]) => Res): { client: SupabaseServer; deletes: string[] } {
  const deletes: string[] = [];
  function makeBuilder(table: string) {
    const ops: Op[] = [];
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      ops.push([name, args]);
      if (name === 'delete') deletes.push(table);
      return builder;
    };
    for (const m of ['select', 'eq', 'in', 'is', 'or', 'not', 'order', 'range', 'limit', 'update', 'insert', 'delete', 'upsert']) {
      builder[m] = chain(m);
    }
    builder.single = () => Promise.resolve(resolve(table, ops));
    builder.maybeSingle = () => Promise.resolve(resolve(table, ops));
    builder.then = (cb: (r: Res) => unknown) => Promise.resolve(cb(resolve(table, ops)));
    return builder;
  }
  return { client: { from: (table: string) => makeBuilder(table) } as never, deletes };
}

const okDeps: CreateBusinessDeps = {
  assignPhoneNumber: async () => ({ assigned: true, e164Number: '+302100000000', managedPhoneNumberId: 'm1' }),
};

function hasInsert(ops: Op[]): boolean { return ops.some((o) => o[0] === 'insert'); }
function hasDelete(ops: Op[]): boolean { return ops.some((o) => o[0] === 'delete'); }

describe('createBusinessForOwner (parity)', () => {
  it('invalid_input (400) when name is missing', async () => {
    const { client } = fakeSupabase(() => ({ data: null }));
    await expect(createBusinessForOwner(client, 'u1', { packageKey: 'pro' }, okDeps))
      .rejects.toMatchObject({ code: 'invalid_input', status: 400 });
  });

  it('invalid_package (400) when packageKey is missing', async () => {
    const { client } = fakeSupabase(() => ({ data: null }));
    await expect(createBusinessForOwner(client, 'u1', { name: 'X' }, okDeps))
      .rejects.toMatchObject({ code: 'invalid_package', status: 400 });
  });

  it('invalid_postal_code (400) on a non-5-digit postal code', async () => {
    const { client } = fakeSupabase(() => ({ data: null }));
    await expect(createBusinessForOwner(client, 'u1', { name: 'X', packageKey: 'pro', postal_code: '12' }, okDeps))
      .rejects.toMatchObject({ code: 'invalid_postal_code', status: 400 });
  });

  it('invalid_package (400) when the plan is not active/known', async () => {
    const { client } = fakeSupabase((t) => (t === 'package_plans' ? { data: null } : { data: null }));
    await expect(createBusinessForOwner(client, 'u1', { name: 'X', packageKey: 'ghost' }, okDeps))
      .rejects.toMatchObject({ code: 'invalid_package', status: 400 });
  });

  it('business_already_exists (409) when the owner already has a business', async () => {
    const { client } = fakeSupabase((t, ops) => {
      if (t === 'package_plans') return { data: { plan_key: 'pro' } };
      if (t === 'businesses' && !hasInsert(ops)) return { data: { id: 'existing' } };
      return { data: null };
    });
    await expect(createBusinessForOwner(client, 'u1', { name: 'X', packageKey: 'pro' }, okDeps))
      .rejects.toMatchObject({ code: 'business_already_exists', status: 409 });
  });

  it('creates the business, member + subscription and returns the success payload', async () => {
    const { client } = fakeSupabase((t, ops) => {
      if (t === 'package_plans') return { data: { plan_key: 'pro' } };
      if (t === 'businesses' && hasInsert(ops)) return { data: { id: 'biz1', name: 'X' } };
      if (t === 'businesses') return { data: null }; // existing check
      if (t === 'business_users') return { error: null };
      if (t === 'business_subscriptions') return { error: null };
      return { data: null, error: null };
    });
    const result = await createBusinessForOwner(client, 'u1', { name: 'X', packageKey: 'pro' }, okDeps);
    expect(result).toEqual({
      business: { id: 'biz1', name: 'X', business_phone_number: '+302100000000' },
      phoneAssigned: true,
      subscriptionStatus: 'pending_payment',
      numberRequest: null,
    });
  });

  it('records a pending number request when no number is assigned', async () => {
    const deps: CreateBusinessDeps = { assignPhoneNumber: async () => ({ assigned: false, e164Number: null, managedPhoneNumberId: null }) };
    const { client } = fakeSupabase((t, ops) => {
      if (t === 'package_plans') return { data: { plan_key: 'pro' } };
      if (t === 'businesses' && hasInsert(ops)) return { data: { id: 'biz1', name: 'X' } };
      if (t === 'businesses') return { data: null };
      if (t === 'business_users') return { error: null };
      if (t === 'business_subscriptions') return { error: null };
      if (t === 'phone_number_requests') return { error: null };
      return { data: null, error: null };
    });
    const result = await createBusinessForOwner(client, 'u1', { name: 'X', packageKey: 'pro', city: 'Αθήνα' }, deps);
    expect(result.phoneAssigned).toBe(false);
    expect(result.business.business_phone_number).toBeNull();
    expect(result.numberRequest).toEqual({ status: 'pending', requestedCity: 'Αθήνα' });
  });

  it('retries the subscription as pending_manual_review on a pre-061 CHECK violation', async () => {
    let subCalls = 0;
    const { client } = fakeSupabase((t, ops) => {
      if (t === 'package_plans') return { data: { plan_key: 'pro' } };
      if (t === 'businesses' && hasInsert(ops)) return { data: { id: 'biz1', name: 'X' } };
      if (t === 'businesses') return { data: null };
      if (t === 'business_users') return { error: null };
      if (t === 'business_subscriptions') {
        subCalls += 1;
        return subCalls === 1 ? { error: { code: '23514' } } : { error: null };
      }
      return { data: null, error: null };
    });
    const result = await createBusinessForOwner(client, 'u1', { name: 'X', packageKey: 'pro' }, okDeps);
    expect(result.subscriptionStatus).toBe('pending_manual_review');
    expect(subCalls).toBe(2);
  });

  it('rolls back business + member and throws subscription_init_failed on a hard sub error', async () => {
    const { client, deletes } = fakeSupabase((t, ops) => {
      if (t === 'package_plans') return { data: { plan_key: 'pro' } };
      if (t === 'businesses' && hasInsert(ops)) return { data: { id: 'biz1', name: 'X' } };
      if (t === 'businesses' && hasDelete(ops)) return { error: null };
      if (t === 'businesses') return { data: null };
      if (t === 'business_users') return { error: null };
      if (t === 'business_subscriptions') return { error: { code: '500', message: 'boom' } };
      return { data: null, error: null };
    });
    await expect(createBusinessForOwner(client, 'u1', { name: 'X', packageKey: 'pro' }, okDeps))
      .rejects.toMatchObject({ code: 'subscription_init_failed', status: 500 });
    expect(deletes).toContain('business_users');
    expect(deletes).toContain('businesses');
  });
});
