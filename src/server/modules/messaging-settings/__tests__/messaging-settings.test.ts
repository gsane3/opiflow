import { describe, it, expect } from 'vitest';
import { getMessagingSettings, updateMessagingSettings, MESSAGING_DEFAULTS } from '../messaging-settings.service';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; maybeSingle(): FB; update(v?: unknown): FB;
  then(r: (x: Res) => unknown): unknown;
}
type Ctx = Parameters<typeof getMessagingSettings>[0];
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): Ctx {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), eq: rec('eq'), maybeSingle: rec('maybeSingle'), update: rec('update'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { businessId: 'b1', supabase: { from } as unknown as Ctx['supabase'] };
}

describe('getMessagingSettings (parity)', () => {
  it('degrades to defaults when the row/columns are missing (pre-044)', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '42703' } }));
    expect(await getMessagingSettings(ctx)).toEqual({ settings: MESSAGING_DEFAULTS, degraded: true });
  });
  it('maps stored values (and parses business_hours)', async () => {
    const ctx = fakeCtx(() => ({ data: {
      business_hours: { days: [1, 2, 3], open: '09:00', close: '17:00' },
      auto_reply_enabled: true, auto_reply_text: 'Λείπω', weekly_summary_enabled: false,
    } }));
    expect(await getMessagingSettings(ctx)).toEqual({ settings: {
      businessHours: { days: [1, 2, 3], open: '09:00', close: '17:00' },
      autoReplyEnabled: true, autoReplyText: 'Λείπω', weeklySummaryEnabled: false,
    } });
  });
  it('rejects malformed business_hours to null', async () => {
    const ctx = fakeCtx(() => ({ data: { business_hours: { days: [], open: 'x', close: '17:00' }, auto_reply_enabled: false, auto_reply_text: null, weekly_summary_enabled: true } }));
    const r = await getMessagingSettings(ctx);
    expect(r.settings.businessHours).toBeNull();
    expect(r.settings.weeklySummaryEnabled).toBe(true);
  });
});

describe('updateMessagingSettings (parity)', () => {
  it('no_fields when nothing recognized is supplied', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    await expect(updateMessagingSettings(ctx, { bogus: 1 })).rejects.toMatchObject({ code: 'no_fields', status: 400 });
  });
  it('updated:true on success', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    expect(await updateMessagingSettings(ctx, { autoReplyEnabled: true })).toEqual({ updated: true });
  });
  it('updated:false when the write fails (pre-044)', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '42703' } }));
    expect(await updateMessagingSettings(ctx, { weeklySummaryEnabled: false })).toEqual({ updated: false });
  });
});
