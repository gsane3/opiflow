import { describe, it, expect } from 'vitest';
import {
  buildIntakeLink,
  buildUploadLink,
  buildAppointmentLink,
} from '../customer-links.service';
import type { RepoContext } from '../customer-links.repo';

// ---------------------------------------------------------------------------
// Hermetic fake Supabase client.
//
// These tests exercise ONLY the pure validation / ownership guards that fire
// BEFORE any external effect (token mint, send dispatcher, email, timeline
// logging, or service-role token lookup). Those effectful libs are imported
// directly by the service and are intentionally never reached here.
//
// `resolve(table, ops)` returns the `{ data?, error? }` for each builder chain,
// keyed by the table name. The builder records every op and is awaitable via
// `.then` (PostgREST builders are thenable), so the repo's
// `await supabase.from(t).select().eq()...maybeSingle()` resolves to it.
// ---------------------------------------------------------------------------

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB;
  eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB;
  gt(a?: unknown, b?: unknown): FB;
  is(a?: unknown, b?: unknown): FB;
  neq(a?: unknown, b?: unknown): FB;
  update(v?: unknown): FB;
  insert(v?: unknown): FB;
  delete(): FB;
  maybeSingle(): FB;
  single(): FB;
  then(r: (x: Res) => unknown): unknown;
}

function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), eq: rec('eq'), in: rec('in'), gt: rec('gt'), is: rec('is'),
      neq: rec('neq'), update: rec('update'), insert: rec('insert'), delete: rec('delete'),
      maybeSingle: rec('maybeSingle'), single: rec('single'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const okCustomer = { id: 'c1', mobile_phone: null, phone: null, email: null, preferred_contact_method: null };

// A ctx where businesses + customers resolve, work_folders absent (no workFolderId
// is passed in the guard tests, so the folder lookup is never actually issued).
function ctxWithCustomer(extra: (table: string) => Res = () => ({ data: null })): RepoContext {
  return fakeCtx((t) => {
    if (t === 'businesses') return { data: { id: 'b1', name: 'Biz', email: null } };
    if (t === 'customers') return { data: okCustomer };
    return extra(t);
  });
}

// ---------------------------------------------------------------------------
// Shared shell guards (mode + customer ownership) — identical across all three.
// ---------------------------------------------------------------------------

describe('customer-links — mode validation', () => {
  it('intake: invalid_mode for an unknown mode', async () => {
    const ctx = ctxWithCustomer();
    await expect(buildIntakeLink(ctx, 'c1', { mode: 'nope' }))
      .rejects.toMatchObject({ code: 'invalid_mode', status: 400 });
  });
  it('upload: invalid_mode for a blank mode', async () => {
    const ctx = ctxWithCustomer();
    await expect(buildUploadLink(ctx, 'c1', { mode: '   ' }))
      .rejects.toMatchObject({ code: 'invalid_mode', status: 400 });
  });
  it('appointment: invalid_mode for an unknown mode', async () => {
    const ctx = ctxWithCustomer();
    await expect(buildAppointmentLink(ctx, 'c1', { mode: 'nope' }))
      .rejects.toMatchObject({ code: 'invalid_mode', status: 400 });
  });
});

describe('customer-links — customer ownership gate', () => {
  it('intake: customer_not_found when the customer is missing', async () => {
    const ctx = fakeCtx((t) => (t === 'businesses' ? { data: null } : { data: null }));
    await expect(buildIntakeLink(ctx, 'c1', {}))
      .rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
  it('upload: customer_not_found when the customer is missing', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(buildUploadLink(ctx, 'c1', {}))
      .rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
  it('appointment: customer_not_found when the customer is missing', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(buildAppointmentLink(ctx, 'c1', { taskId: 't1' }))
      .rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });

  it('intake: server_error when the customer lookup errors on BOTH attempts', async () => {
    // fetchCustomer retries without preferred_contact_method on the first error;
    // both attempts erroring → error:true → server_error.
    const ctx = fakeCtx((t) => (t === 'customers' ? { error: { message: 'db down' } } : { data: null }));
    await expect(buildIntakeLink(ctx, 'c1', {}))
      .rejects.toMatchObject({ code: 'server_error', status: 500 });
  });
});

// ---------------------------------------------------------------------------
// Work-folder authorization (WF-4B) — passes a workFolderId so the lookup runs.
// ---------------------------------------------------------------------------

describe('customer-links — work folder authorization', () => {
  it('intake: folder_not_found when the folder is not in this tenant', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: { id: 'b1', name: 'Biz', email: null } };
      if (t === 'customers') return { data: okCustomer };
      if (t === 'work_folders') return { data: null };
      return { data: null };
    });
    await expect(buildUploadLink(ctx, 'c1', { workFolderId: 'wf1' }))
      .rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });
  it('intake: customer_mismatch when the folder belongs to another customer', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: { id: 'b1', name: 'Biz', email: null } };
      if (t === 'customers') return { data: okCustomer };
      if (t === 'work_folders') return { data: { customer_id: 'other' } };
      return { data: null };
    });
    await expect(buildIntakeLink(ctx, 'c1', { workFolderId: 'wf1' }))
      .rejects.toMatchObject({ code: 'customer_mismatch', status: 409 });
  });
});

// ---------------------------------------------------------------------------
// Appointment-specific guards (task id / task gate) — all before any lib call.
// ---------------------------------------------------------------------------

describe('buildAppointmentLink — task guards', () => {
  const business = { id: 'b1', name: 'Biz', email: null };

  it('missing_task_id when neither taskId nor appointmentId is provided', async () => {
    const ctx = ctxWithCustomer();
    await expect(buildAppointmentLink(ctx, 'c1', {}))
      .rejects.toMatchObject({ code: 'missing_task_id', status: 400 });
  });

  it('appointment_not_found when the task is missing', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: business };
      if (t === 'customers') return { data: okCustomer };
      if (t === 'tasks') return { data: null };
      return { data: null };
    });
    await expect(buildAppointmentLink(ctx, 'c1', { taskId: 't1' }))
      .rejects.toMatchObject({ code: 'appointment_not_found', status: 404 });
  });

  it('server_error when the task lookup errors', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: business };
      if (t === 'customers') return { data: okCustomer };
      if (t === 'tasks') return { error: { message: 'boom' } };
      return { data: null };
    });
    await expect(buildAppointmentLink(ctx, 'c1', { taskId: 't1' }))
      .rejects.toMatchObject({ code: 'server_error', status: 500 });
  });

  it('invalid_task_type when the task is not an appointment type', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: business };
      if (t === 'customers') return { data: okCustomer };
      if (t === 'tasks') return { data: { id: 't1', business_id: 'b1', customer_id: 'c1', type: 'call_back', status: 'open', due_date: null, due_time: null } };
      return { data: null };
    });
    await expect(buildAppointmentLink(ctx, 'c1', { taskId: 't1' }))
      .rejects.toMatchObject({ code: 'invalid_task_type', status: 400 });
  });

  it('appointment_not_sendable when the task is cancelled or completed', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: business };
      if (t === 'customers') return { data: okCustomer };
      if (t === 'tasks') return { data: { id: 't1', business_id: 'b1', customer_id: 'c1', type: 'book_appointment', status: 'completed', due_date: null, due_time: null } };
      return { data: null };
    });
    await expect(buildAppointmentLink(ctx, 'c1', { taskId: 't1' }))
      .rejects.toMatchObject({ code: 'appointment_not_sendable', status: 400 });
  });

  it('accepts the appointmentId alias for taskId (reaches the task gate, not missing_task_id)', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: business };
      if (t === 'customers') return { data: okCustomer };
      if (t === 'tasks') return { data: null };
      return { data: null };
    });
    await expect(buildAppointmentLink(ctx, 'c1', { appointmentId: 't1' }))
      .rejects.toMatchObject({ code: 'appointment_not_found', status: 404 });
  });
});
