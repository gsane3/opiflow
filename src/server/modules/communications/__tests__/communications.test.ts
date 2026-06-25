import { describe, it, expect } from 'vitest';
import {
  listCommunications,
  createCommunication,
  updateCommunication,
  deleteCommunication,
  dbToCommunication,
} from '../communications.service';
import type { CommunicationCustomerRow, CommunicationRow } from '../communications.types';
import type { RepoContext } from '../communications.repo';

type Res = { data: unknown; error: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; update(v?: unknown): FB; delete(): FB;
  eq(a?: unknown, b?: unknown): FB; lte(a?: unknown, b?: unknown): FB; in(a?: unknown, b?: unknown): FB;
  is(a?: unknown, b?: unknown): FB; or(a?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  range(a?: number, b?: number): FB; limit(n?: number): FB; single(): FB; maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), delete: rec('delete'),
      eq: rec('eq'), lte: rec('lte'), in: rec('in'), is: rec('is'), or: rec('or'),
      order: rec('order'), range: rec('range'), limit: rec('limit'), single: rec('single'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const commRow: CommunicationRow = {
  id: 'm1', customer_id: 'c1', channel: 'call', direction: 'inbound', status: 'completed',
  phone: '+302101234567', summary: 'σύνοψη', created_at: '2026-01-01T00:00:00Z',
};
const custRow: CommunicationCustomerRow = {
  id: 'c1', crm_number: '#3', name: 'Μαρία', company_name: null, phone: '+302101234567',
  source: 'inbound_call', status: 'new',
};

describe('dbToCommunication', () => {
  it('maps with a joined customer', () => {
    const dto = dbToCommunication(commRow, custRow);
    expect(dto.customerId).toBe('c1');
    expect(dto.customer?.crmNumber).toBe('#3');
  });
  it('maps with no customer', () => {
    expect(dbToCommunication(commRow, null).customer).toBeNull();
  });
});

describe('createCommunication (parity)', () => {
  it('rejects a non-call channel', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createCommunication(ctx, { channel: 'sms', direction: 'inbound', status: 'completed' }))
      .rejects.toMatchObject({ code: 'invalid_channel', status: 400 });
  });
  it('rejects an invalid direction', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createCommunication(ctx, { channel: 'call', direction: 'sideways', status: 'completed' }))
      .rejects.toMatchObject({ code: 'invalid_direction' });
  });
  it('rejects an invalid status', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createCommunication(ctx, { channel: 'call', direction: 'inbound', status: 'pending' }))
      .rejects.toMatchObject({ code: 'invalid_status' });
  });
  it('inserts a call and maps the result', async () => {
    const captured: Record<string, unknown>[] = [];
    const ctx = fakeCtx((_t, ops) => {
      const ins = ops.find((o) => o.m === 'insert');
      if (ins) { captured.push(ins.args[0] as Record<string, unknown>); return { data: commRow, error: null }; }
      return { data: null, error: null };
    });
    const dto = await createCommunication(ctx, { channel: 'call', direction: 'inbound', status: 'completed' });
    expect(dto.channel).toBe('call');
    expect(captured[0]).toMatchObject({ channel: 'call', direction: 'inbound', status: 'completed' });
  });
});

describe('updateCommunication (parity)', () => {
  it('rejects a non-string customerId', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(updateCommunication(ctx, 'm1', { customerId: 42 }))
      .rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('404s when no row matches the tenant', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null })); // update→maybeSingle returns null
    await expect(updateCommunication(ctx, 'm1', {}))
      .rejects.toMatchObject({ code: 'communication_not_found', status: 404 });
  });
});

describe('deleteCommunication (parity)', () => {
  it('404s when the communication does not exist', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null })); // exists check → null
    await expect(deleteCommunication(ctx, 'nope'))
      .rejects.toMatchObject({ code: 'communication_not_found', status: 404 });
  });
});

describe('listCommunications (join assembly)', () => {
  it('rejects an invalid channel filter', async () => {
    const ctx = fakeCtx(() => ({ data: [], error: null }));
    await expect(listCommunications(ctx, { channel: 'pigeon' }))
      .rejects.toMatchObject({ code: 'invalid_channel' });
  });
  it('joins each communication to its customer', async () => {
    const ctx = fakeCtx((table) => {
      if (table === 'communications') return { data: [commRow], error: null };
      if (table === 'customers') return { data: [custRow], error: null };
      return { data: null, error: null };
    });
    const list = await listCommunications(ctx, {});
    expect(list).toHaveLength(1);
    expect(list[0].customer?.name).toBe('Μαρία');
  });
});
