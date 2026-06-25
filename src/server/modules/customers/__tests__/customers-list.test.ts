import { describe, it, expect } from 'vitest';
import { listCustomersForApi, createCustomerForApi, dbToCustomerListItem } from '../customers-list';
import type { RepoContext } from '../customers.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; update(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB; is(a?: unknown, b?: unknown): FB; or(a?: unknown): FB;
  in(a?: unknown, b?: unknown): FB; order(a?: unknown, b?: unknown): FB; range(a?: unknown, b?: unknown): FB;
  limit(n?: number): FB; single(): FB; then(r: (x: Res) => unknown): unknown;
}
function ctxOf(
  resolve: (table: string, ops: Op[]) => Res,
  rpc?: () => Res,
): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), eq: rec('eq'),
      is: rec('is'), or: rec('or'), in: rec('in'), order: rec('order'), range: rec('range'),
      limit: rec('limit'), single: rec('single'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  const supabase = { from, rpc: () => ({ then: (r: (x: Res) => unknown) => r(rpc ? rpc() : { data: null }) }) };
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: supabase as unknown as RepoContext['supabase'] };
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', crm_number: '#1', name: 'Γιώργος', company_name: null, phone: '+302101234567',
    mobile_phone: null, landline_phone: null, email: null, address: 'Οδός 1', source: 'manual_entry',
    status: 'new', opportunity_value: null, needs_summary: null, notes: null,
    preferred_contact_method: 'phone', intake_status: 'none', last_contact_at: null,
    created_at: '2026-06-01', updated_at: '2026-06-01', status_summary: null, business_notes: null,
    personal_notes: null, next_best_action: null, memory_updated_at: null, ...over,
  };
}

function classify(ops: Op[]): 'list' | 'needsIntake' | 'pins' | 'imported' | 'other' {
  if (ops.some((o) => o.m === 'range')) return 'list';
  if (ops.some((o) => o.m === 'in' && o.args[0] === 'intake_status')) return 'needsIntake';
  if (ops.some((o) => o.m === 'eq' && o.args[0] === 'pinned')) return 'pins';
  if (ops.some((o) => o.m === 'in' && o.args[0] === 'id')) return 'imported';
  return 'other';
}

describe('dbToCustomerListItem', () => {
  it('maps the list DTO in the exact key order', () => {
    const item = dbToCustomerListItem(row() as never);
    expect(Object.keys(item)).toEqual([
      'id', 'crmNumber', 'name', 'companyName', 'phone', 'mobilePhone', 'landlinePhone', 'email',
      'address', 'postalCode', 'region', 'source', 'status', 'opportunityValue', 'needsSummary',
      'notes', 'preferredContactMethod', 'intakeStatus', 'lastContactAt', 'createdAt', 'updatedAt',
      'nextTaskId', 'statusSummary', 'businessNotes', 'personalNotes', 'nextBestAction',
      'memoryUpdatedAt', 'pinned', 'importedFromPhone', 'needsIntake',
    ]);
    expect(item.pinned).toBe(false);
    expect(item.importedFromPhone).toBe(false);
    expect(item.needsIntake).toBe(false);
  });
});

describe('listCustomersForApi (parity)', () => {
  it('invalid_status (400) on a bad status filter', async () => {
    const ctx = ctxOf(() => ({ data: [] }));
    await expect(listCustomersForApi(ctx, new URLSearchParams('status=bogus')))
      .rejects.toMatchObject({ code: 'invalid_status', status: 400 });
  });

  it('customers_query_failed (500) when both list queries error', async () => {
    const ctx = ctxOf((_t, ops) => (classify(ops) === 'list' ? { error: { message: 'boom' } } : { data: [] }));
    await expect(listCustomersForApi(ctx, new URLSearchParams()))
      .rejects.toMatchObject({ code: 'customers_query_failed', status: 500 });
  });

  it('maps the base list (no extras) with needsIntake/pinned/imported all false', async () => {
    const ctx = ctxOf((_t, ops) => {
      if (classify(ops) === 'list') return { data: [row()] };
      return { data: [] };
    });
    const customers = await listCustomersForApi(ctx, new URLSearchParams());
    expect(customers).toHaveLength(1);
    expect(customers[0].id).toBe('c1');
    expect(customers[0].needsIntake).toBe(false);
    expect(customers[0].pinned).toBe(false);
    expect(customers[0].importedFromPhone).toBe(false);
  });

  it('prepends needs-intake contacts to the top of the first page', async () => {
    const ctx = ctxOf((_t, ops) => {
      const kind = classify(ops);
      if (kind === 'list') return { data: [row({ id: 'c2', name: 'Άλλος' })] };
      if (kind === 'needsIntake') return { data: [row({ id: 'c1', intake_status: 'sent' })] };
      return { data: [] };
    });
    const customers = await listCustomersForApi(ctx, new URLSearchParams());
    expect(customers.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(customers[0].needsIntake).toBe(true);
    expect(customers[1].needsIntake).toBe(false);
  });

  it('annotates the pin flag from the pins query', async () => {
    const ctx = ctxOf((_t, ops) => {
      const kind = classify(ops);
      if (kind === 'list') return { data: [row({ id: 'c1' }), row({ id: 'c2' })] };
      if (kind === 'pins') return { data: [{ id: 'c2' }] };
      return { data: [] };
    });
    const customers = await listCustomersForApi(ctx, new URLSearchParams());
    expect(customers.find((c) => c.id === 'c2')?.pinned).toBe(true);
    expect(customers.find((c) => c.id === 'c1')?.pinned).toBe(false);
  });
});

describe('createCustomerForApi (parity)', () => {
  it('invalid_customer (400) when no identifying field is present', async () => {
    const ctx = ctxOf(() => ({ data: null }));
    await expect(createCustomerForApi(ctx, {})).rejects.toMatchObject({ code: 'invalid_customer', status: 400 });
  });

  it('invalid_status (400) on a bad status enum', async () => {
    const ctx = ctxOf(() => ({ data: null }));
    await expect(createCustomerForApi(ctx, { name: 'Α', status: 'bogus' }))
      .rejects.toMatchObject({ code: 'invalid_status', status: 400 });
  });

  it('creates and returns the list-item', async () => {
    const ctx = ctxOf(
      (t, ops) => {
        if (t === 'customers' && ops.some((o) => o.m === 'insert')) return { data: row({ id: 'cN', crm_number: '#5', name: 'Νέος' }) };
        return { data: null };
      },
      () => ({ data: 5 }),
    );
    const created = await createCustomerForApi(ctx, { name: 'Νέος' });
    expect(created.id).toBe('cN');
    expect(created.crmNumber).toBe('#5');
    expect(created.name).toBe('Νέος');
    expect(created.needsIntake).toBe(false);
  });

  it('customer_create_failed (500) when the insert errors', async () => {
    const ctx = ctxOf(
      (t, ops) => {
        if (t === 'customers' && ops.some((o) => o.m === 'insert')) return { error: { message: 'boom' } };
        return { data: null };
      },
      () => ({ data: 5 }),
    );
    await expect(createCustomerForApi(ctx, { name: 'Νέος' }))
      .rejects.toMatchObject({ code: 'customer_create_failed', status: 500 });
  });
});
