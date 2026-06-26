import { describe, it, expect } from 'vitest';
import {
  addPoolNumber,
  assignPendingRequest,
  getPool,
  isAssignAction,
  parsePatchBody,
  releaseNumber,
} from '../phone-pool.service';
import { requirePhonePoolAdmin, type RepoContext } from '../phone-pool.repo';
import { AppError } from '../../../core/errors';

// ---------------------------------------------------------------------------
// Hermetic context: supabase.from(table) records the chained ops and resolves
// through the supplied resolver; supabase.rpc(name,args) resolves through the
// rpc resolver. assignPhoneNumber (the external SQL helper) is NOT exercised —
// the assign tests cover only the pure validation/guard throws BEFORE that call.
// ---------------------------------------------------------------------------

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB;
  insert(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB;
  order(a?: unknown, b?: unknown): FB;
  limit(n?: number): FB;
  single(): FB;
  maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}

function fakeCtx(
  resolve: (table: string, ops: Op[]) => Res,
  rpcResolve: (name: string, args: unknown) => Res = () => ({ data: null }),
): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), eq: rec('eq'), in: rec('in'),
      order: rec('order'), limit: rec('limit'), single: rec('single'),
      maybeSingle: rec('maybeSingle'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  const rpc = (name: string, args: unknown) => ({
    then: (r: (x: Res) => unknown) => r(rpcResolve(name, args)),
  });
  return { supabase: { from, rpc } as unknown as RepoContext['supabase'] };
}

// A minimal auth client stub for requirePhonePoolAdmin.
function authClient(result: { user: { id: string } | null; error?: unknown }) {
  return {
    auth: {
      getUser: async () => ({ data: { user: result.user }, error: result.error ?? null }),
    },
  } as unknown as RepoContext['supabase'];
}

const ADMIN = 'admin-uid';
const VALID_UUID = '11111111-1111-1111-1111-111111111111';

// ---------------------------------------------------------------------------
// Auth gate (parity)
// ---------------------------------------------------------------------------

describe('requirePhonePoolAdmin (parity)', () => {
  it('missing_auth when no authorization header', async () => {
    await expect(requirePhonePoolAdmin(null, { getAdminUserId: () => ADMIN }))
      .rejects.toMatchObject({ code: 'missing_auth', status: 401 });
  });

  it('missing_auth when the header is not Bearer', async () => {
    await expect(requirePhonePoolAdmin('Basic xyz', { getAdminUserId: () => ADMIN }))
      .rejects.toMatchObject({ code: 'missing_auth', status: 401 });
  });

  it('admin_not_configured when ADMIN_USER_ID is unset', async () => {
    await expect(requirePhonePoolAdmin('Bearer tok', { getAdminUserId: () => undefined }))
      .rejects.toMatchObject({ code: 'admin_not_configured', status: 503 });
  });

  it('propagates missing_supabase_config from the client factory', async () => {
    await expect(requirePhonePoolAdmin('Bearer tok', {
      getAdminUserId: () => ADMIN,
      createClient: () => { throw new AppError('missing_supabase_config', 503); },
    })).rejects.toMatchObject({ code: 'missing_supabase_config', status: 503 });
  });

  it('propagates phone_pool_route_failed from the client factory', async () => {
    await expect(requirePhonePoolAdmin('Bearer tok', {
      getAdminUserId: () => ADMIN,
      createClient: () => { throw new AppError('phone_pool_route_failed', 500); },
    })).rejects.toMatchObject({ code: 'phone_pool_route_failed', status: 500 });
  });

  it('invalid_auth when getUser errors', async () => {
    await expect(requirePhonePoolAdmin('Bearer tok', {
      getAdminUserId: () => ADMIN,
      createClient: () => authClient({ user: null, error: { message: 'bad' } }),
    })).rejects.toMatchObject({ code: 'invalid_auth', status: 401 });
  });

  it('invalid_auth when there is no user', async () => {
    await expect(requirePhonePoolAdmin('Bearer tok', {
      getAdminUserId: () => ADMIN,
      createClient: () => authClient({ user: null }),
    })).rejects.toMatchObject({ code: 'invalid_auth', status: 401 });
  });

  it('forbidden when the user is not the configured admin', async () => {
    await expect(requirePhonePoolAdmin('Bearer tok', {
      getAdminUserId: () => ADMIN,
      createClient: () => authClient({ user: { id: 'someone-else' } }),
    })).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('returns the authed client on the happy path', async () => {
    const client = authClient({ user: { id: ADMIN } });
    const ctx = await requirePhonePoolAdmin('Bearer tok', {
      getAdminUserId: () => ADMIN,
      createClient: () => client,
    });
    expect(ctx.supabase).toBe(client);
  });
});

// ---------------------------------------------------------------------------
// GET getPool (parity)
// ---------------------------------------------------------------------------

describe('getPool (parity)', () => {
  it('pool_query_failed when the pool query errors', async () => {
    const ctx = fakeCtx((t) =>
      t === 'managed_phone_numbers' ? { error: { message: 'boom' } } : { data: null });
    await expect(getPool(ctx)).rejects.toMatchObject({ code: 'pool_query_failed', status: 500 });
  });

  it('computes stats and returns empty pending list when no rows', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'managed_phone_numbers') return { data: [] };
      if (t === 'phone_number_requests') return { data: [] };
      return { data: null };
    });
    const r = await getPool(ctx);
    expect(r.stats.total).toBe(0);
    expect(r.numbers).toEqual([]);
    expect(r.pendingNumberRequests).toEqual([]);
    expect(r.pendingRequestsError).toBeNull();
  });

  it('counts by status/city/type and enriches assignments', async () => {
    const rows = [
      { id: 'm1', e164_number: '+302100000001', provider: 'intertelecom', city: 'Αθήνα', number_type: 'geo', status: 'assigned', imported_at: '2026-01-02T00:00:00Z', assigned_at: null, cooling_down_since: null, available_after: null, retired_at: null },
      { id: 'm2', e164_number: '+302100000002', provider: 'intertelecom', city: null, number_type: null, status: 'available', imported_at: '2026-01-01T00:00:00Z', assigned_at: null, cooling_down_since: null, available_after: null, retired_at: null },
    ];
    const ctx = fakeCtx((t) => {
      if (t === 'managed_phone_numbers') return { data: rows };
      if (t === 'business_phone_numbers') return { data: [{ managed_phone_number_id: 'm1', business_id: 'b1', status: 'active' }] };
      if (t === 'businesses') return { data: [{ id: 'b1', name: 'Acme' }] };
      if (t === 'phone_number_requests') return { data: [] };
      return { data: null };
    });
    const r = await getPool(ctx);
    expect(r.stats.total).toBe(2);
    expect(r.stats.assigned).toBe(1);
    expect(r.stats.available).toBe(1);
    expect(r.stats.by_city).toEqual({ 'Αθήνα': 1, '': 1 });
    expect(r.stats.by_type).toEqual({ geo: 1, unknown: 1 });
    expect(r.numbers[0]).toMatchObject({ id: 'm1', assigned_business_id: 'b1', assigned_business_name: 'Acme', assignment_status: 'active' });
    expect(r.numbers[1]).toMatchObject({ id: 'm2', assigned_business_id: null, assigned_business_name: null, assignment_status: null });
  });

  it('pool_query_failed when the assignment enrichment query errors', async () => {
    const rows = [
      { id: 'm1', e164_number: '+302100000001', provider: 'intertelecom', city: null, number_type: null, status: 'assigned', imported_at: '2026-01-01T00:00:00Z', assigned_at: null, cooling_down_since: null, available_after: null, retired_at: null },
    ];
    const ctx = fakeCtx((t) => {
      if (t === 'managed_phone_numbers') return { data: rows };
      if (t === 'business_phone_numbers') return { error: { message: 'boom' } };
      return { data: null };
    });
    await expect(getPool(ctx)).rejects.toMatchObject({ code: 'pool_query_failed', status: 500 });
  });

  it('sets pendingRequestsError (non-fatal) when the pending query errors', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'managed_phone_numbers') return { data: [] };
      if (t === 'phone_number_requests') return { error: { message: 'boom' } };
      return { data: null };
    });
    const r = await getPool(ctx);
    expect(r.pendingRequestsError).toBe('pending_requests_query_failed');
    expect(r.pendingNumberRequests).toEqual([]);
  });

  it('maps pending requests with safe business metadata', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'managed_phone_numbers') return { data: [] };
      if (t === 'phone_number_requests') return { data: [{ id: 'r1', business_id: 'b1', requested_city: 'Πάτρα', source: 'web', status: 'pending', created_at: '2026-03-01T00:00:00Z' }] };
      if (t === 'businesses') return { data: [{ id: 'b1', name: 'Acme', city: 'Αθήνα' }] };
      return { data: null };
    });
    const r = await getPool(ctx);
    expect(r.stats.pendingNumberRequests).toBe(1);
    expect(r.pendingNumberRequests[0]).toEqual({
      request_id: 'r1', business_id: 'b1', business_name: 'Acme', business_city: 'Αθήνα',
      requested_city: 'Πάτρα', source: 'web', status: 'pending', created_at: '2026-03-01T00:00:00Z',
    });
  });
});

// ---------------------------------------------------------------------------
// POST addPoolNumber (parity)
// ---------------------------------------------------------------------------

describe('addPoolNumber (parity)', () => {
  const ok = fakeCtx((t) =>
    t === 'managed_phone_numbers'
      ? { data: { id: 'm9', e164_number: '+302100000009', provider: 'intertelecom', city: null, number_type: null, status: 'available', imported_at: '2026-01-01T00:00:00Z', assigned_at: null, cooling_down_since: null, available_after: null, retired_at: null } }
      : { data: null });

  it('invalid_input when the body is not an object', async () => {
    await expect(addPoolNumber(ok, [])).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
    await expect(addPoolNumber(ok, null)).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
  });

  it('invalid_e164 when missing or malformed', async () => {
    await expect(addPoolNumber(ok, {})).rejects.toMatchObject({ code: 'invalid_e164', status: 400 });
    await expect(addPoolNumber(ok, { e164_number: '12345' })).rejects.toMatchObject({ code: 'invalid_e164', status: 400 });
  });

  it('invalid_provider for a non-allowed provider', async () => {
    await expect(addPoolNumber(ok, { e164_number: '+302100000009', provider: 'twilio' }))
      .rejects.toMatchObject({ code: 'invalid_provider', status: 400 });
  });

  it('invalid_notes when not a string or too long', async () => {
    await expect(addPoolNumber(ok, { e164_number: '+302100000009', notes: 5 }))
      .rejects.toMatchObject({ code: 'invalid_notes', status: 400 });
    await expect(addPoolNumber(ok, { e164_number: '+302100000009', notes: 'x'.repeat(501) }))
      .rejects.toMatchObject({ code: 'invalid_notes', status: 400 });
  });

  it('invalid_city when not a string or too long', async () => {
    await expect(addPoolNumber(ok, { e164_number: '+302100000009', city: 5 }))
      .rejects.toMatchObject({ code: 'invalid_city', status: 400 });
    await expect(addPoolNumber(ok, { e164_number: '+302100000009', city: 'x'.repeat(101) }))
      .rejects.toMatchObject({ code: 'invalid_city', status: 400 });
  });

  it('duplicate_number on a unique violation', async () => {
    const ctx = fakeCtx((t) =>
      t === 'managed_phone_numbers' ? { error: { code: '23505' } } : { data: null });
    await expect(addPoolNumber(ctx, { e164_number: '+302100000009' }))
      .rejects.toMatchObject({ code: 'duplicate_number', status: 409 });
  });

  it('pool_insert_failed on other insert errors', async () => {
    const ctx = fakeCtx((t) =>
      t === 'managed_phone_numbers' ? { error: { code: '500', message: 'db down' } } : { data: null });
    await expect(addPoolNumber(ctx, { e164_number: '+302100000009' }))
      .rejects.toMatchObject({ code: 'pool_insert_failed', status: 500 });
  });

  it('returns the inserted row (defaults provider to intertelecom)', async () => {
    const row = await addPoolNumber(ok, { e164_number: '+302100000009', city: 'Αθήνα', notes: 'hi' });
    expect(row).toMatchObject({ id: 'm9', e164_number: '+302100000009', status: 'available' });
  });
});

// ---------------------------------------------------------------------------
// PATCH parse + dispatch (parity)
// ---------------------------------------------------------------------------

describe('parsePatchBody / isAssignAction', () => {
  it('invalid_input when the body is not an object', () => {
    expect(() => parsePatchBody(null)).toThrow(AppError);
    expect(() => parsePatchBody([])).toThrow(AppError);
  });
  it('detects the assign action', () => {
    expect(isAssignAction({ action: 'assign_pending_request' })).toBe(true);
    expect(isAssignAction({ action: 'other' })).toBe(false);
    expect(isAssignAction({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PATCH assignPendingRequest (parity — validation + guard throws BEFORE the
// external assignPhoneNumber lib call)
// ---------------------------------------------------------------------------

describe('assignPendingRequest (parity)', () => {
  const dummy = fakeCtx(() => ({ data: null }));

  it('missing_business_id when absent or blank', async () => {
    await expect(assignPendingRequest(dummy, {})).rejects.toMatchObject({ code: 'missing_business_id', status: 400 });
    await expect(assignPendingRequest(dummy, { business_id: '   ' })).rejects.toMatchObject({ code: 'missing_business_id', status: 400 });
  });

  it('invalid_business_id when not a UUID', async () => {
    await expect(assignPendingRequest(dummy, { business_id: 'not-a-uuid' }))
      .rejects.toMatchObject({ code: 'invalid_business_id', status: 400 });
  });

  it('invalid_city when requested_city is not a string or too long', async () => {
    await expect(assignPendingRequest(dummy, { business_id: VALID_UUID, requested_city: 5 }))
      .rejects.toMatchObject({ code: 'invalid_city', status: 400 });
    await expect(assignPendingRequest(dummy, { business_id: VALID_UUID, requested_city: 'x'.repeat(101) }))
      .rejects.toMatchObject({ code: 'invalid_city', status: 400 });
  });

  it('assign_rpc_failed when the business lookup errors', async () => {
    const ctx = fakeCtx((t) => t === 'businesses' ? { error: { message: 'boom' } } : { data: null });
    await expect(assignPendingRequest(ctx, { business_id: VALID_UUID }))
      .rejects.toMatchObject({ code: 'assign_rpc_failed', status: 500 });
  });

  it('business_not_found when no business row', async () => {
    const ctx = fakeCtx((t) => t === 'businesses' ? { data: null } : { data: null });
    await expect(assignPendingRequest(ctx, { business_id: VALID_UUID }))
      .rejects.toMatchObject({ code: 'business_not_found', status: 404 });
  });

  it('assign_rpc_failed when the pending lookup errors', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: { id: VALID_UUID, city: null } };
      if (t === 'phone_number_requests') return { error: { message: 'boom' } };
      return { data: null };
    });
    await expect(assignPendingRequest(ctx, { business_id: VALID_UUID }))
      .rejects.toMatchObject({ code: 'assign_rpc_failed', status: 500 });
  });

  it('pending_request_not_found when no pending row', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: { id: VALID_UUID, city: null } };
      if (t === 'phone_number_requests') return { data: null };
      return { data: null };
    });
    await expect(assignPendingRequest(ctx, { business_id: VALID_UUID }))
      .rejects.toMatchObject({ code: 'pending_request_not_found', status: 404 });
  });
});

// ---------------------------------------------------------------------------
// PATCH releaseNumber (parity)
// ---------------------------------------------------------------------------

describe('releaseNumber (parity)', () => {
  const dummy = fakeCtx(() => ({ data: null }));

  it('missing_business_id when not a string', async () => {
    await expect(releaseNumber(dummy, {})).rejects.toMatchObject({ code: 'missing_business_id', status: 400 });
  });

  it('invalid_business_id when not a UUID', async () => {
    await expect(releaseNumber(dummy, { business_id: 'nope' }))
      .rejects.toMatchObject({ code: 'invalid_business_id', status: 400 });
  });

  it('invalid_release_reason when not a string or too long', async () => {
    await expect(releaseNumber(dummy, { business_id: VALID_UUID, release_reason: 5 }))
      .rejects.toMatchObject({ code: 'invalid_release_reason', status: 400 });
    await expect(releaseNumber(dummy, { business_id: VALID_UUID, release_reason: 'x'.repeat(101) }))
      .rejects.toMatchObject({ code: 'invalid_release_reason', status: 400 });
  });

  it('release_rpc_failed when the RPC errors', async () => {
    const ctx = fakeCtx(() => ({ data: null }), () => ({ error: { message: 'boom' } }));
    await expect(releaseNumber(ctx, { business_id: VALID_UUID }))
      .rejects.toMatchObject({ code: 'release_rpc_failed', status: 500 });
  });

  it('release_rpc_failed when the RPC returns no rows', async () => {
    const ctx = fakeCtx(() => ({ data: null }), () => ({ data: [] }));
    await expect(releaseNumber(ctx, { business_id: VALID_UUID }))
      .rejects.toMatchObject({ code: 'release_rpc_failed', status: 500 });
  });

  it('returns released metadata without forwarding e164_number', async () => {
    const ctx = fakeCtx(() => ({ data: null }), () => ({
      data: [{ released: true, managed_phone_number_id: 'm1', e164_number: '+302100000001', available_after: '2027-12-01T00:00:00Z' }],
    }));
    const r = await releaseNumber(ctx, { business_id: VALID_UUID, release_reason: 'cancelled' });
    expect(r).toEqual({ released: true, managed_phone_number_id: 'm1', available_after: '2027-12-01T00:00:00Z' });
    expect(r).not.toHaveProperty('e164_number');
  });
});
