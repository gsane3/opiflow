import { describe, it, expect, vi } from 'vitest';
import { createAppointmentResponseLink } from '../appointment-links.service';
import type { RepoContext } from '../appointment-links.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), eq: rec('eq'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

// A fake token-mint dependency that mirrors the lib's result shape (row.* fields).
function fakeMint(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (params: { businessId: string; taskId: string; sentChannel?: string; sentTo?: string | null; expiryHours?: number }) => ({
    rawToken: 'raw',
    tokenHash: 'hash',
    responseUrl: 'https://app/appointment-response/raw',
    row: {
      id: 'tok1',
      business_id: params.businessId,
      task_id: params.taskId,
      token_hash: 'hash',
      status: params.sentChannel && params.sentChannel !== 'manual' ? 'sent' : 'pending',
      sent_channel: params.sentChannel ?? 'manual',
      sent_to: params.sentTo ?? null,
      expires_at: '2026-07-01T00:00:00.000Z',
      opened_at: null,
      responded_at: null,
      response: null,
      response_comment: null,
      requested_due_date: null,
      requested_due_time: null,
      revoked_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    },
  })) as unknown as Parameters<typeof createAppointmentResponseLink>[2] extends { mintToken?: infer M } ? M : never;
}

const noDb = fakeCtx(() => ({ data: null }));
const openAppointmentTask = { id: 't1', business_id: 'b1', customer_id: null, type: 'book_appointment', status: 'open' };

describe('createAppointmentResponseLink (parity validation — before any DB/lib call)', () => {
  it('invalid_task_id when taskId missing', async () => {
    await expect(createAppointmentResponseLink(noDb, {}))
      .rejects.toMatchObject({ code: 'invalid_task_id', status: 400 });
  });
  it('invalid_task_id when taskId is blank', async () => {
    await expect(createAppointmentResponseLink(noDb, { taskId: '   ' }))
      .rejects.toMatchObject({ code: 'invalid_task_id', status: 400 });
  });
  it('invalid_sent_channel for an unknown channel', async () => {
    await expect(createAppointmentResponseLink(noDb, { taskId: 't1', sentChannel: 'carrier-pigeon' }))
      .rejects.toMatchObject({ code: 'invalid_sent_channel', status: 400 });
  });
  it('invalid_expiry_hours when out of range (>168)', async () => {
    await expect(createAppointmentResponseLink(noDb, { taskId: 't1', expiryHours: 200 }))
      .rejects.toMatchObject({ code: 'invalid_expiry_hours', status: 400 });
  });
  it('invalid_expiry_hours when non-integer', async () => {
    await expect(createAppointmentResponseLink(noDb, { taskId: 't1', expiryHours: 1.5 }))
      .rejects.toMatchObject({ code: 'invalid_expiry_hours', status: 400 });
  });
  it('invalid_expiry_hours when below range (<1)', async () => {
    await expect(createAppointmentResponseLink(noDb, { taskId: 't1', expiryHours: 0 }))
      .rejects.toMatchObject({ code: 'invalid_expiry_hours', status: 400 });
  });
});

describe('createAppointmentResponseLink (task gate)', () => {
  it('task_not_found when the task is missing', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { data: null } : { data: null }));
    await expect(createAppointmentResponseLink(ctx, { taskId: 't1' }, { mintToken: fakeMint() }))
      .rejects.toMatchObject({ code: 'task_not_found', status: 404 });
  });
  it('invalid_task_type when the task is not an appointment type', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { data: { ...openAppointmentTask, type: 'call_back' } } : { data: null }));
    await expect(createAppointmentResponseLink(ctx, { taskId: 't1' }, { mintToken: fakeMint() }))
      .rejects.toMatchObject({ code: 'invalid_task_type', status: 400 });
  });
  it('invalid_task_status when the task is not open', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { data: { ...openAppointmentTask, status: 'completed' } } : { data: null }));
    await expect(createAppointmentResponseLink(ctx, { taskId: 't1' }, { mintToken: fakeMint() }))
      .rejects.toMatchObject({ code: 'invalid_task_status', status: 400 });
  });
  it('appointment_response_link_create_failed (500) when the task lookup errors', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { error: { message: 'db down' } } : { data: null }));
    await expect(createAppointmentResponseLink(ctx, { taskId: 't1' }, { mintToken: fakeMint() }))
      .rejects.toMatchObject({ code: 'appointment_response_link_create_failed', status: 500 });
  });
});

describe('createAppointmentResponseLink (token mint)', () => {
  it('maps the minted row into the safe token payload (manual default)', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { data: openAppointmentTask } : { data: null }));
    const result = await createAppointmentResponseLink(ctx, { taskId: 't1' }, { mintToken: fakeMint() });
    expect(result).toEqual({
      responseUrl: 'https://app/appointment-response/raw',
      token: {
        id: 'tok1',
        status: 'pending',
        sentChannel: 'manual',
        sentTo: null,
        expiresAt: '2026-07-01T00:00:00.000Z',
        taskId: 't1',
      },
    });
  });
  it('passes sentChannel/sentTo/expiryHours through to the mint and reflects them', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { data: openAppointmentTask } : { data: null }));
    const mint = fakeMint();
    const result = await createAppointmentResponseLink(
      ctx,
      { taskId: 't1', sentChannel: 'email', sentTo: 'a@b.gr', expiryHours: 24 },
      { mintToken: mint },
    );
    expect(mint).toHaveBeenCalledWith({ businessId: 'b1', taskId: 't1', sentChannel: 'email', sentTo: 'a@b.gr', expiryHours: 24 });
    expect(result.token.status).toBe('sent');
    expect(result.token.sentChannel).toBe('email');
    expect(result.token.sentTo).toBe('a@b.gr');
  });
  it('converts a mint throw into the catch-all code (appointment_response_link_create_failed 500)', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { data: openAppointmentTask } : { data: null }));
    const throwingMint = vi.fn(async () => { throw new Error('boom'); }) as unknown as Parameters<typeof createAppointmentResponseLink>[2] extends { mintToken?: infer M } ? M : never;
    await expect(createAppointmentResponseLink(ctx, { taskId: 't1' }, { mintToken: throwingMint }))
      .rejects.toMatchObject({ code: 'appointment_response_link_create_failed', status: 500 });
  });
});
