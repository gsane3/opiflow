// Cross-tenant isolation — proof that tenantDb CANNOT be mis-tenanted.
//
// The whole app talks to Postgres through the SERVICE-ROLE client, which bypasses
// RLS. Tenant isolation therefore lives in the code: every query must carry
// .eq('business_id', <caller's business>). tenantDb makes that structural. These
// tests prove the wrapper injects the filter on EVERY operation and that an insert
// can never be written under a different tenant — i.e. Business A's queries are
// always scoped to A, so they can never read or write Business B's rows.

import { describe, it, expect } from 'vitest';
import { tenantDb } from '../tenant';

// A recording fake: client.from(table) returns a builder that logs every chained
// call (method + args) and returns itself, so we can inspect exactly what tenantDb
// asked the real PostgREST builder to do.
function recordingClient() {
  function from(table: string) {
    const ops: Array<{ m: string; args: unknown[] }> = [];
    const b: Record<string, unknown> = { __ops: ops, __table: table };
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        return (...args: unknown[]) => { ops.push({ m: String(prop), args }); return proxy; };
      },
    };
    const proxy = new Proxy(b, handler);
    return proxy;
  }
  return { from } as unknown as Parameters<typeof tenantDb>[0];
}

type Ops = Array<{ m: string; args: unknown[] }>;
const opsOf = (q: unknown): Ops => (q as { __ops: Ops }).__ops;
const hasEq = (ops: Ops, col: string, val: unknown) =>
  ops.some((o) => o.m === 'eq' && o.args[0] === col && o.args[1] === val);

describe('tenantDb — structural business_id isolation', () => {
  it('select() always appends .eq(business_id, <tenant>)', () => {
    const c = recordingClient();
    const q = tenantDb(c, 'biz-A').from('customers').select('id, name');
    const ops = opsOf(q);
    expect(ops[0]).toEqual({ m: 'select', args: ['id, name'] });
    expect(hasEq(ops, 'business_id', 'biz-A')).toBe(true);
    // and NEVER another tenant
    expect(hasEq(ops, 'business_id', 'biz-B')).toBe(false);
  });

  it('byId() scopes to BOTH business_id AND id (never just id)', () => {
    const c = recordingClient();
    const q = tenantDb(c, 'biz-A').from('offers').byId('o1', 'id');
    const ops = opsOf(q);
    expect(hasEq(ops, 'business_id', 'biz-A')).toBe(true);
    expect(hasEq(ops, 'id', 'o1')).toBe(true);
  });

  it('insert() injects the caller business_id', () => {
    const c = recordingClient();
    const q = tenantDb(c, 'biz-A').from('customers').insert({ name: 'X' });
    const insert = opsOf(q).find((o) => o.m === 'insert')!;
    expect((insert.args[0] as Record<string, unknown>).business_id).toBe('biz-A');
  });

  it('insert() OVERRIDES an attacker-supplied foreign business_id (cannot be mis-tenanted)', () => {
    const c = recordingClient();
    const q = tenantDb(c, 'biz-A').from('customers').insert({ name: 'X', business_id: 'biz-B' });
    const insert = opsOf(q).find((o) => o.m === 'insert')!;
    // business_id is spread LAST in tenantDb, so the caller's tenant wins.
    expect((insert.args[0] as Record<string, unknown>).business_id).toBe('biz-A');
  });

  it('insert() of an array scopes EVERY row to the caller business_id', () => {
    const c = recordingClient();
    const q = tenantDb(c, 'biz-A')
      .from('customers')
      .insert([{ name: 'X' }, { name: 'Y', business_id: 'biz-B' }]);
    const insert = opsOf(q).find((o) => o.m === 'insert')!;
    const rows = insert.args[0] as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.business_id === 'biz-A')).toBe(true);
  });

  it('update() is scoped to the tenant', () => {
    const c = recordingClient();
    const q = tenantDb(c, 'biz-A').from('customers').update({ name: 'X' });
    expect(hasEq(opsOf(q), 'business_id', 'biz-A')).toBe(true);
  });

  it('delete() is scoped to the tenant', () => {
    const c = recordingClient();
    const q = tenantDb(c, 'biz-A').from('customers').delete();
    expect(hasEq(opsOf(q), 'business_id', 'biz-A')).toBe(true);
  });

  it('two different tenants produce two different, non-overlapping filters', () => {
    const c = recordingClient();
    const qa = tenantDb(c, 'biz-A').from('customers').select('*');
    const qb = tenantDb(c, 'biz-B').from('customers').select('*');
    expect(hasEq(opsOf(qa), 'business_id', 'biz-A')).toBe(true);
    expect(hasEq(opsOf(qa), 'business_id', 'biz-B')).toBe(false);
    expect(hasEq(opsOf(qb), 'business_id', 'biz-B')).toBe(true);
    expect(hasEq(opsOf(qb), 'business_id', 'biz-A')).toBe(false);
  });
});
