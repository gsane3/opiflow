import { describe, it, expect, vi, afterEach } from 'vitest';
import { listNotifications } from '../notifications.service';

// ---------------------------------------------------------------------------
// Hermetic Supabase fake. supabase.from(table) returns a chainable builder that
// records the table name; every chain method returns the same builder, and the
// builder is thenable so `await db.from(t)...` resolves to resolve(table).
// ---------------------------------------------------------------------------

type ResolveFn = (table: string) => { data?: unknown[]; error?: unknown };

function makeCtx(resolve: ResolveFn) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of [
      'select',
      'eq',
      'in',
      'is',
      'or',
      'not',
      'order',
      'range',
      'limit',
      'gte',
      'lte',
      'single',
      'maybeSingle',
      'update',
      'insert',
      'delete',
      'upsert',
    ]) {
      builder[m] = vi.fn(chain);
    }
    builder.then = (onFulfilled: (r: { data?: unknown[]; error?: unknown }) => unknown) =>
      Promise.resolve(resolve(table)).then(onFulfilled);
    return builder;
  };
  return {
    userId: 'u1',
    businessId: 'b1',
    role: 'owner',
    supabase: { from } as unknown as never,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listNotifications', () => {
  it('returns an empty list when every source query is empty', async () => {
    const ctx = makeCtx(() => ({ data: [] }));
    const out = await listNotifications(ctx);
    expect(out).toEqual([]);
  });

  it('throws notifications_query_failed (500) when the offer-token query errors', async () => {
    const ctx = makeCtx((table) =>
      table === 'offer_response_tokens' ? { data: [], error: { message: 'boom' } } : { data: [] },
    );
    await expect(listNotifications(ctx)).rejects.toMatchObject({
      code: 'notifications_query_failed',
      status: 500,
    });
  });

  it('throws notifications_query_failed (500) when the appointment-token query errors', async () => {
    const ctx = makeCtx((table) =>
      table === 'appointment_response_tokens'
        ? { data: [], error: { message: 'boom' } }
        : { data: [] },
    );
    await expect(listNotifications(ctx)).rejects.toMatchObject({
      code: 'notifications_query_failed',
      status: 500,
    });
  });

  it('maps an unexpected DB rejection to notifications_query_failed (500)', async () => {
    const ctx = makeCtx((table) => {
      if (table === 'communications') throw new Error('connection reset');
      return { data: [] };
    });
    await expect(listNotifications(ctx)).rejects.toMatchObject({
      code: 'notifications_query_failed',
      status: 500,
    });
  });

  it('builds an accepted-offer notification with the Greek title and key fields', async () => {
    const respondedAt = new Date().toISOString();
    const ctx = makeCtx((table) => {
      switch (table) {
        case 'offer_response_tokens':
          return {
            data: [{ id: 'tok1', offer_id: 'o1', response: 'accepted', responded_at: respondedAt }],
          };
        case 'offers':
          return { data: [{ id: 'o1', offer_number: 'PR-7', customer_id: 'c1' }] };
        case 'customers':
          return { data: [{ id: 'c1', name: 'Γιώργος', company_name: null, crm_number: null }] };
        default:
          return { data: [] };
      }
    });
    const out = await listNotifications(ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'tok1',
      kind: 'offer',
      response: 'accepted',
      title: 'Αποδοχή προσφοράς',
      description: 'Ο πελάτης Γιώργος αποδέχτηκε την προσφορά PR-7.',
      customerId: 'c1',
      customerName: 'Γιώργος',
      href: '/customers/c1',
      eventAt: respondedAt,
      respondedAt,
      isNew: true,
      taskId: null,
      requestedDueDate: null,
      requestedDueTime: null,
    });
  });

  it('falls back to the «Πελάτης» display name when no customer row resolves', async () => {
    const respondedAt = new Date().toISOString();
    const ctx = makeCtx((table) => {
      switch (table) {
        case 'appointment_response_tokens':
          return {
            data: [
              {
                id: 'a1',
                task_id: 't1',
                response: 'accepted',
                responded_at: respondedAt,
                requested_due_date: null,
                requested_due_time: null,
              },
            ],
          };
        case 'tasks':
          return { data: [{ id: 't1', title: null, customer_id: null }] };
        default:
          return { data: [] };
      }
    });
    const out = await listNotifications(ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'appointment',
      title: 'Αποδοχή ραντεβού',
      description: 'Ο πελάτης Πελάτης αποδέχτηκε το ραντεβού.',
      customerId: null,
      taskId: 't1',
    });
  });
});
