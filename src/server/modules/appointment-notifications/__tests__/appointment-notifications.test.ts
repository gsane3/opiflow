import { describe, it, expect, vi } from 'vitest';
import { sendAppointmentNotification } from '../appointment-notifications.service';
import type { RepoContext } from '../appointment-notifications.repo';

// ---------------------------------------------------------------------------
// Hermetic fake Supabase: from(table) records ops; .then(r) resolves with the
// table-specific result supplied by the test. The service uses tenantDb, which
// adds .eq('business_id', …); the service then chains .eq('id', …).maybeSingle().
// ---------------------------------------------------------------------------

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB;
  eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB;
  is(a?: unknown, b?: unknown): FB;
  or(a?: unknown): FB;
  not(a?: unknown, b?: unknown, c?: unknown): FB;
  order(a?: unknown, b?: unknown): FB;
  range(a?: unknown, b?: unknown): FB;
  limit(a?: unknown): FB;
  single(): FB;
  maybeSingle(): FB;
  update(v?: unknown): FB;
  insert(v?: unknown): FB;
  delete(): FB;
  upsert(v?: unknown): FB;
  then(r: (x: Res) => unknown): unknown;
}

function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), eq: rec('eq'), in: rec('in'), is: rec('is'), or: rec('or'),
      not: rec('not'), order: rec('order'), range: rec('range'), limit: rec('limit'),
      single: rec('single'), maybeSingle: rec('maybeSingle'),
      update: rec('update'), insert: rec('insert'), delete: rec('delete'), upsert: rec('upsert'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return {
    userId: 'u1',
    businessId: 'biz12345abcdef',
    role: 'owner',
    supabase: { from } as unknown as RepoContext['supabase'],
  };
}

// A minimal token-mint stub mirroring createAppointmentResponseToken's result.
function fakeMint(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (params: { businessId: string; taskId: string; sentChannel?: string; sentTo?: string | null }) => ({
    rawToken: 'raw',
    tokenHash: 'hash',
    responseUrl: 'https://app/appointment-response/raw',
    row: {
      id: 'tok99999abcdef',
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
  })) as unknown as NonNullable<Parameters<typeof sendAppointmentNotification>[2]>['mintToken'];
}

const noDb = fakeCtx(() => ({ data: null }));

const openTask = {
  id: 't1',
  business_id: 'biz12345abcdef',
  customer_id: null as string | null,
  type: 'book_appointment',
  status: 'open',
  due_date: '2026-07-10',
  due_time: '10:00',
};

function taskOnly(task: Record<string, unknown> | null, error = false) {
  return fakeCtx((t) => {
    if (t === 'tasks') return error ? { error: { message: 'db down' } } : { data: task };
    return { data: null };
  });
}

describe('sendAppointmentNotification — body validation (exact codes/order)', () => {
  it('invalid_body when body is not an object', async () => {
    await expect(sendAppointmentNotification(noDb, 'nope'))
      .rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('invalid_body when body is null', async () => {
    await expect(sendAppointmentNotification(noDb, null))
      .rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('invalid_body when body is an array', async () => {
    await expect(sendAppointmentNotification(noDb, []))
      .rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('invalid_body when taskId missing', async () => {
    await expect(sendAppointmentNotification(noDb, { kind: 'proposal' }))
      .rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('invalid_body when taskId blank', async () => {
    await expect(sendAppointmentNotification(noDb, { taskId: '  ', kind: 'proposal' }))
      .rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('invalid_body when kind missing', async () => {
    await expect(sendAppointmentNotification(noDb, { taskId: 't1' }))
      .rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('unsupported_kind for an unknown kind', async () => {
    await expect(sendAppointmentNotification(noDb, { taskId: 't1', kind: 'reminder' }))
      .rejects.toMatchObject({ code: 'unsupported_kind', status: 400 });
  });
  it('invalid_mode for an unknown mode', async () => {
    await expect(sendAppointmentNotification(noDb, { taskId: 't1', kind: 'proposal', mode: 'fax' }))
      .rejects.toMatchObject({ code: 'invalid_mode', status: 400 });
  });
});

describe('sendAppointmentNotification — task gate', () => {
  it('appointment_notification_failed (500) when the task lookup errors', async () => {
    await expect(sendAppointmentNotification(taskOnly(null, true), { taskId: 't1', kind: 'proposal' }))
      .rejects.toMatchObject({ code: 'appointment_notification_failed', status: 500 });
  });
  it('task_not_found (404) when the task is missing', async () => {
    await expect(sendAppointmentNotification(taskOnly(null), { taskId: 't1', kind: 'proposal' }))
      .rejects.toMatchObject({ code: 'task_not_found', status: 404 });
  });
  it('unsupported_task_type when the task is not an appointment type', async () => {
    await expect(sendAppointmentNotification(taskOnly({ ...openTask, type: 'call_back' }), { taskId: 't1', kind: 'proposal' }, { mintToken: fakeMint() }))
      .rejects.toMatchObject({ code: 'unsupported_task_type', status: 400 });
  });
  it('appointment_not_sendable when the task is completed', async () => {
    await expect(sendAppointmentNotification(taskOnly({ ...openTask, status: 'completed' }), { taskId: 't1', kind: 'proposal' }, { mintToken: fakeMint() }))
      .rejects.toMatchObject({ code: 'appointment_not_sendable', status: 400 });
  });
  it('appointment_not_sendable when the task is cancelled', async () => {
    await expect(sendAppointmentNotification(taskOnly({ ...openTask, status: 'cancelled' }), { taskId: 't1', kind: 'time_change_approved' }))
      .rejects.toMatchObject({ code: 'appointment_not_sendable', status: 400 });
  });
});

describe('sendAppointmentNotification — draft mode (no Apifon)', () => {
  it('returns a draft proposal with the response URL embedded in the text (token minted)', async () => {
    const mint = fakeMint();
    const res = await sendAppointmentNotification(taskOnly(openTask), { taskId: 't1', kind: 'proposal' }, { mintToken: mint });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      sent: false,
      channel: 'viber',
      status: 'draft',
      reason: null,
      fallbackMessage: expect.stringContaining('https://app/appointment-response/raw'),
    });
    // draft → token minted with sentChannel 'manual'
    expect(mint).toHaveBeenCalledWith({ businessId: 'biz12345abcdef', taskId: 't1', sentChannel: 'manual', sentTo: null });
    // response URL is embedded only, never a standalone field
    expect(res.body).not.toHaveProperty('responseUrl');
  });
  it('returns a draft for time_change_approved without minting a token', async () => {
    const res = await sendAppointmentNotification(taskOnly(openTask), { taskId: 't1', kind: 'time_change_approved' });
    expect(res.body).toMatchObject({ ok: true, sent: false, channel: 'viber', status: 'draft', reason: null });
    expect(String(res.body.fallbackMessage)).toContain('Η αλλαγή ώρας εγκρίθηκε');
  });
  it('returns a draft for time_change_rejected', async () => {
    const res = await sendAppointmentNotification(taskOnly(openTask), { taskId: 't1', kind: 'time_change_rejected' });
    expect(String(res.body.fallbackMessage)).toContain('Δυστυχώς δεν μπορούμε να αλλάξουμε την ώρα');
  });
  it('proposal token mint failure → appointment_notification_failed (500)', async () => {
    const throwingMint = vi.fn(async () => { throw new Error('boom'); }) as unknown as NonNullable<Parameters<typeof sendAppointmentNotification>[2]>['mintToken'];
    await expect(sendAppointmentNotification(taskOnly(openTask), { taskId: 't1', kind: 'proposal' }, { mintToken: throwingMint }))
      .rejects.toMatchObject({ code: 'appointment_notification_failed', status: 500 });
  });
});

describe('sendAppointmentNotification — send mode fallbacks', () => {
  it('missing_customer when the task has no customer_id', async () => {
    const res = await sendAppointmentNotification(taskOnly({ ...openTask, customer_id: null }), { taskId: 't1', kind: 'proposal', mode: 'send' }, { mintToken: fakeMint() });
    expect(res.body).toMatchObject({ ok: true, sent: false, status: 'fallback_required', reason: 'missing_customer' });
  });

  it('missing_customer when the customer row is absent', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'tasks') return { data: { ...openTask, customer_id: 'c1' } };
      return { data: null }; // customers → not found
    });
    const res = await sendAppointmentNotification(ctx, { taskId: 't1', kind: 'time_change_approved', mode: 'send' }, {});
    expect(res.body).toMatchObject({ status: 'fallback_required', reason: 'missing_customer' });
  });

  it('missing_mobile when the customer has no usable phone', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'tasks') return { data: { ...openTask, customer_id: 'c1' } };
      if (t === 'customers') return { data: { id: 'c1', name: 'A', mobile_phone: null, phone: '2101234567' } };
      return { data: null };
    });
    const res = await sendAppointmentNotification(ctx, { taskId: 't1', kind: 'time_change_approved', mode: 'send' }, {});
    expect(res.body).toMatchObject({ status: 'fallback_required', reason: 'missing_mobile' });
  });

  it('provider_unavailable when Viber send is skipped for missing_apifon_config', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'tasks') return { data: { ...openTask, customer_id: 'c1' } };
      if (t === 'customers') return { data: { id: 'c1', name: 'A', mobile_phone: '6900000000', phone: null } };
      return { data: null };
    });
    const sendViber = vi.fn(async () => ({ ok: false, skipped: true, reason: 'missing_apifon_config' })) as unknown as NonNullable<Parameters<typeof sendAppointmentNotification>[2]>['sendViber'];
    const res = await sendAppointmentNotification(ctx, { taskId: 't1', kind: 'time_change_approved', mode: 'send' }, { sendViber });
    expect(res.body).toMatchObject({ status: 'fallback_required', reason: 'provider_unavailable' });
  });

  it('missing_mobile when Viber send is skipped for missing_or_invalid_phone', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'tasks') return { data: { ...openTask, customer_id: 'c1' } };
      if (t === 'customers') return { data: { id: 'c1', name: 'A', mobile_phone: '6900000000', phone: null } };
      return { data: null };
    });
    const sendViber = vi.fn(async () => ({ ok: false, skipped: true, reason: 'missing_or_invalid_phone' })) as unknown as NonNullable<Parameters<typeof sendAppointmentNotification>[2]>['sendViber'];
    const res = await sendAppointmentNotification(ctx, { taskId: 't1', kind: 'time_change_approved', mode: 'send' }, { sendViber });
    expect(res.body).toMatchObject({ status: 'fallback_required', reason: 'missing_mobile' });
  });

  it('provider_failed when the Viber send returns ok:false (not skipped)', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'tasks') return { data: { ...openTask, customer_id: 'c1' } };
      if (t === 'customers') return { data: { id: 'c1', name: 'A', mobile_phone: '6900000000', phone: null } };
      return { data: null };
    });
    const sendViber = vi.fn(async () => ({ ok: false, skipped: false, responseStatus: 500, error: 'apifon_send_failed' })) as unknown as NonNullable<Parameters<typeof sendAppointmentNotification>[2]>['sendViber'];
    const res = await sendAppointmentNotification(ctx, { taskId: 't1', kind: 'time_change_approved', mode: 'send' }, { sendViber });
    expect(res.body).toMatchObject({ status: 'fallback_required', reason: 'provider_failed' });
  });
});

describe('sendAppointmentNotification — send mode success', () => {
  it('sent:true with requestId/messageId and a token-based referenceId', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'tasks') return { data: { ...openTask, customer_id: 'c1' } };
      if (t === 'customers') return { data: { id: 'c1', name: 'A', mobile_phone: '6900000000', phone: null } };
      return { data: null };
    });
    const sendViber = vi.fn(async () => ({ ok: true, skipped: false, responseStatus: 200, requestId: 'req1', messageId: 'msg1' })) as unknown as NonNullable<Parameters<typeof sendAppointmentNotification>[2]>['sendViber'];
    const res = await sendAppointmentNotification(ctx, { taskId: 't1', kind: 'proposal', mode: 'send' }, { mintToken: fakeMint(), sendViber });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      sent: true,
      channel: 'viber',
      status: 'sent',
      reason: null,
      fallbackMessage: null,
      requestId: 'req1',
      messageId: 'msg1',
    });
    // proposal+send mints with sentChannel 'viber'; referenceId uses 8-char business + token prefixes
    const call = (sendViber as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { referenceId: string; phone: string; customerId: string };
    expect(call.referenceId).toBe('appt-notif:biz12345:tok99999');
    expect(call.customerId).toBe('c1');
  });

  it('referenceId falls back to the task id when no token is minted (non-proposal kind)', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'tasks') return { data: { ...openTask, customer_id: 'c1' } };
      if (t === 'customers') return { data: { id: 'c1', name: 'A', mobile_phone: '6900000000', phone: null } };
      return { data: null };
    });
    const sendViber = vi.fn(async () => ({ ok: true, skipped: false, responseStatus: 200, requestId: 'req1', messageId: 'msg1' })) as unknown as NonNullable<Parameters<typeof sendAppointmentNotification>[2]>['sendViber'];
    await sendAppointmentNotification(ctx, { taskId: 't1', kind: 'time_change_approved', mode: 'send' }, { sendViber });
    const call = (sendViber as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { referenceId: string };
    expect(call.referenceId).toBe('appt-notif:biz12345:t1');
  });
});
