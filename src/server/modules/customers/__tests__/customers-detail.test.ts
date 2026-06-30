import { describe, it, expect } from 'vitest';
import { getCustomer, updateCustomer, deleteCustomer } from '../customers.service';
import type { CustomerDetailRow } from '../customers.types';
import type { RepoContext } from '../customers.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; update(v?: unknown): FB; delete(): FB; eq(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), update: rec('update'), delete: rec('delete'), eq: rec('eq'),
      maybeSingle: rec('maybeSingle'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const customerRow: CustomerDetailRow = {
  id: 'c1', crm_number: '#1', name: 'Γιώργος', company_name: null, phone: '+306900000000',
  mobile_phone: null, landline_phone: null, email: null, address: 'Αθήνα', source: 'manual_entry',
  status: 'new', opportunity_value: null, needs_summary: null, notes: null,
  preferred_contact_method: 'phone', intake_status: 'none', last_contact_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  status_summary: null, business_notes: null, personal_notes: null, next_best_action: null, memory_updated_at: null,
};
const cols = (ops: Op[]) => (ops.find((o) => o.m === 'select')?.args[0] ?? '') as string;
const noDb = fakeCtx(() => ({ data: null }));

describe('getCustomer (parity)', () => {
  it('customer_not_found when no row', async () => {
    const ctx = fakeCtx((t, ops) => (t === 'customers' && cols(ops).includes('crm_number') ? { data: null } : { data: null }));
    await expect(getCustomer(ctx, 'c1')).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
  it('customer_query_failed on db error', async () => {
    const ctx = fakeCtx((t, ops) => (t === 'customers' && cols(ops).includes('crm_number') ? { error: { message: 'boom' } } : { data: null }));
    await expect(getCustomer(ctx, 'c1')).rejects.toMatchObject({ code: 'customer_query_failed', status: 500 });
  });
  it('maps the core row and folds in the tolerant pinned read', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t !== 'customers') return { data: null };
      const c = cols(ops);
      if (c.includes('crm_number')) return { data: customerRow };  // core fetch
      if (c === 'pinned') return { data: { pinned: true } };        // 044 read
      return { data: null };                                       // 053/058/067 → defaults
    });
    const customer = await getCustomer(ctx, 'c1');
    expect(customer.id).toBe('c1');
    expect(customer.name).toBe('Γιώργος');
    expect(customer.pinned).toBe(true);
    expect(customer.postalCode).toBeNull();
    expect(customer.blocked).toBe(false);
    expect(customer.vatNumber).toBeNull();
    expect(customer.nextTaskId).toBeNull();
  });

  it('folds in the tolerant 067 vat_number read', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t !== 'customers') return { data: null };
      const c = cols(ops);
      if (c.includes('crm_number')) return { data: customerRow };       // core fetch
      if (c === 'vat_number') return { data: { vat_number: '803311450' } }; // 067 read
      return { data: null };
    });
    const customer = await getCustomer(ctx, 'c1');
    expect(customer.vatNumber).toBe('803311450');
  });

  it('a missing vat_number column (pre-067) keeps vatNumber null without breaking the detail', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t !== 'customers') return { data: null };
      const c = cols(ops);
      if (c.includes('crm_number')) return { data: customerRow };
      if (c === 'vat_number') return { error: { code: '42703', message: 'column "vat_number" does not exist' } };
      return { data: null };
    });
    const customer = await getCustomer(ctx, 'c1');
    expect(customer.id).toBe('c1');
    expect(customer.vatNumber).toBeNull();
  });
});

describe('updateCustomer (parity validation)', () => {
  it('invalid_status / invalid_source / invalid_preferred_contact_method / invalid_intake_status', async () => {
    await expect(updateCustomer(noDb, 'c1', { status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_status', status: 400 });
    await expect(updateCustomer(noDb, 'c1', { source: 'tiktok' })).rejects.toMatchObject({ code: 'invalid_source' });
    await expect(updateCustomer(noDb, 'c1', { preferredContactMethod: 'fax' })).rejects.toMatchObject({ code: 'invalid_preferred_contact_method' });
    await expect(updateCustomer(noDb, 'c1', { intakeStatus: 'weird' })).rejects.toMatchObject({ code: 'invalid_intake_status' });
  });
});

describe('updateCustomer (parity behaviour)', () => {
  it('returns the current customer unchanged when no allowed field is supplied', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: customerRow } : { data: null }));
    const customer = await updateCustomer(ctx, 'c1', {});
    expect(customer.id).toBe('c1');
  });
  it('updates a core field and returns the customer', async () => {
    const ctx = fakeCtx((t, ops) =>
      t === 'customers' && ops.some((o) => o.m === 'update') ? { data: { ...customerRow, name: 'Νέο' } } : { data: customerRow },
    );
    const customer = await updateCustomer(ctx, 'c1', { name: 'Νέο' });
    expect(customer.name).toBe('Νέο');
  });
  it('customer_not_found when the update matches no row', async () => {
    const ctx = fakeCtx((t, ops) => (t === 'customers' && ops.some((o) => o.m === 'update') ? { data: null } : { data: customerRow }));
    await expect(updateCustomer(ctx, 'c1', { name: 'Νέο' })).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });

  it('writes vatNumber via the isolated 067 update and reflects it in the response', async () => {
    let vatWrite: unknown;
    const ctx = fakeCtx((t, ops) => {
      if (t !== 'customers') return { data: null };
      const upd = ops.find((o) => o.m === 'update')?.args[0] as Record<string, unknown> | undefined;
      if (upd && 'vat_number' in upd) { vatWrite = upd.vat_number; return { data: { id: 'c1' } }; } // isolated 067 write
      return { data: customerRow }; // core update (updated_at only) + reads
    });
    const customer = await updateCustomer(ctx, 'c1', { vatNumber: '803311450' });
    expect(vatWrite).toBe('803311450');
    expect(customer.vatNumber).toBe('803311450');
  });
});

describe('deleteCustomer (parity)', () => {
  it('customer_not_found when nothing matched', async () => {
    const ctx = fakeCtx(() => ({ data: [] }));
    await expect(deleteCustomer(ctx, 'c1')).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
  it('returns the deleted count', async () => {
    const ctx = fakeCtx(() => ({ data: [{ id: 'c1' }] }));
    expect(await deleteCustomer(ctx, 'c1')).toEqual({ deleted: 1 });
  });
  it('customer_delete_failed on db error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(deleteCustomer(ctx, 'c1')).rejects.toMatchObject({ code: 'customer_delete_failed', status: 500 });
  });
});
