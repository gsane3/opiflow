import { describe, it, expect } from 'vitest';
import { CreateCustomerSchema, ListCustomersQuerySchema } from '../customers.schema';
import { dbToCustomer } from '../customers.service';
import type { CustomerRow } from '../customers.types';
import { tenantDb } from '../../../core/tenant';

// ---------------------------------------------------------------------------
// Zod input validation
// ---------------------------------------------------------------------------

describe('CreateCustomerSchema', () => {
  it('accepts a customer with at least one identifier', () => {
    const r = CreateCustomerSchema.safeParse({ name: 'Γιώργος' });
    expect(r.success).toBe(true);
  });

  it('rejects a customer with no identifying field', () => {
    const r = CreateCustomerSchema.safeParse({ notes: 'κάτι' });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid status enum', () => {
    const r = CreateCustomerSchema.safeParse({ name: 'Χ', status: 'bogus' });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid source enum', () => {
    const r = CreateCustomerSchema.safeParse({ name: 'Χ', source: 'tiktok' });
    expect(r.success).toBe(false);
  });
});

describe('ListCustomersQuerySchema', () => {
  it('applies defaults', () => {
    const q = ListCustomersQuerySchema.parse({});
    expect(q.sort).toBe('recency');
    expect(q.limit).toBe(50);
    expect(q.offset).toBe(0);
    expect(q.awaiting).toBe(false);
  });

  it('clamps an out-of-range limit', () => {
    const r = ListCustomersQuerySchema.safeParse({ limit: 9999 });
    expect(r.success).toBe(false); // max(100) → caller must send a valid value
  });
});

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

describe('dbToCustomer', () => {
  it('maps snake_case columns to the camelCase DTO', () => {
    const row = {
      id: 'c1',
      crm_number: '#7',
      name: 'Μαρία',
      company_name: null,
      phone: '+302101234567',
      mobile_phone: null,
      landline_phone: null,
      email: null,
      address: 'Αθήνα',
      source: 'manual_entry',
      status: 'new',
      opportunity_value: 120,
      needs_summary: null,
      notes: null,
      preferred_contact_method: 'phone',
      intake_status: 'none',
      last_contact_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      status_summary: null,
      business_notes: null,
      personal_notes: null,
      next_best_action: null,
      memory_updated_at: null,
    } satisfies CustomerRow;

    const dto = dbToCustomer(row);
    expect(dto.crmNumber).toBe('#7');
    expect(dto.companyName).toBeNull();
    expect(dto.opportunityValue).toBe(120);
    expect(dto.preferredContactMethod).toBe('phone');
  });
});

// ---------------------------------------------------------------------------
// Tenant-safe DB wrapper — the core safety primitive
// ---------------------------------------------------------------------------

type Call = [string, ...unknown[]];

function makeMockClient() {
  const calls: Call[] = [];
  const builder = {
    select: (cols?: string) => { calls.push(['select', cols]); return builder; },
    insert: (v: unknown) => { calls.push(['insert', v]); return builder; },
    update: (v: unknown) => { calls.push(['update', v]); return builder; },
    delete: () => { calls.push(['delete']); return builder; },
    eq: (c: string, val: unknown) => { calls.push(['eq', c, val]); return builder; },
  };
  const client = { from: (t: string) => { calls.push(['from', t]); return builder; } };
  return { client, calls };
}

type TenantClient = Parameters<typeof tenantDb>[0];

describe('tenantDb', () => {
  it('forces .eq(business_id) on every select', () => {
    const { client, calls } = makeMockClient();
    tenantDb(client as unknown as TenantClient, 'biz_1').from('customers').select('*');
    expect(calls).toContainEqual(['from', 'customers']);
    expect(calls).toContainEqual(['eq', 'business_id', 'biz_1']);
  });

  it('injects business_id into inserts', () => {
    const { client, calls } = makeMockClient();
    tenantDb(client as unknown as TenantClient, 'biz_1').from('customers').insert({ name: 'X' });
    const insertCall = calls.find((c) => c[0] === 'insert');
    expect(insertCall?.[1]).toEqual({ name: 'X', business_id: 'biz_1' });
  });

  it('scopes updates and deletes to the tenant', () => {
    const { client, calls } = makeMockClient();
    const db = tenantDb(client as unknown as TenantClient, 'biz_9');
    db.from('customers').update({ pinned: true });
    db.from('customers').delete();
    const tenantScopes = calls.filter((c) => c[0] === 'eq' && c[1] === 'business_id' && c[2] === 'biz_9');
    expect(tenantScopes.length).toBe(2);
  });
});
