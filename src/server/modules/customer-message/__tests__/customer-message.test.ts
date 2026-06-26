import { describe, it, expect } from 'vitest';
import {
  sendCustomerMessage,
  type SendCustomerMessageDeps,
  type SendChannelResult,
} from '../customer-message.service';
import type { RepoContext } from '../customer-message.repo';

// ---------------------------------------------------------------------------
// Hermetic fakes.
//
// The covered branches exercise ONLY the post-auth validation + the
// business-scoped customer / work-folder reads (which fire BEFORE any real send),
// plus happy/failed paths where sendViaPreferredChannel, extractProviderIds and
// recordOutboundMessage are INJECTED stubs — the real Apifon send / timeline log
// are never reached. `resolve(table, ops)` returns `{ data?, error? }` per builder
// chain, keyed by table; the builder records ops and is thenable so the repo's
// `await from(t).select()…maybeSingle()` resolves to it.
// ---------------------------------------------------------------------------

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB;
  eq(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB;
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
  return { userId: 'u1', businessId: 'biz12345xyz', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

// Deps whose send/log must never run in the validation tests.
const failDeps: SendCustomerMessageDeps = {
  sendViaPreferredChannel: async () => { throw new Error('sendViaPreferredChannel must not be called'); },
  extractProviderIds: () => { throw new Error('extractProviderIds must not be called'); },
  recordOutboundMessage: async () => { throw new Error('recordOutboundMessage must not be called'); },
};

const sentDetail = { requestId: 'rq1', messageId: 'mg1' };
function okDeps(result: SendChannelResult, sink?: { recorded?: Record<string, unknown> }): SendCustomerMessageDeps {
  return {
    sendViaPreferredChannel: async () => result,
    extractProviderIds: (d) => {
      const x = d as { requestId?: string | null; messageId?: string | null } | null | undefined;
      return { providerRequestId: x?.requestId ?? null, providerMessageId: x?.messageId ?? null };
    },
    recordOutboundMessage: async (p) => { if (sink) sink.recorded = p as unknown as Record<string, unknown>; return { communicationId: 'k1' }; },
  };
}

const custRow = { phone: null, mobile_phone: '+302101234567', landline_phone: null, preferred_contact_method: 'viber' };

describe('sendCustomerMessage — validation (parity)', () => {
  it('empty_text (400) when text is missing or blank', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    expect(await sendCustomerMessage(ctx, 'c1', {}, failDeps)).toEqual({
      payload: { ok: false, error: 'empty_text' }, status: 400,
    });
    expect(await sendCustomerMessage(ctx, 'c1', { text: '   ' }, failDeps)).toEqual({
      payload: { ok: false, error: 'empty_text' }, status: 400,
    });
  });

  it('too_long (400) when text exceeds 1000 chars', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    expect(await sendCustomerMessage(ctx, 'c1', { text: 'x'.repeat(1001) }, failDeps)).toEqual({
      payload: { ok: false, error: 'too_long' }, status: 400,
    });
  });
});

describe('sendCustomerMessage — customer load (parity)', () => {
  it('customer_not_found (404) when no tenant row matches', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: null }));
    expect(await sendCustomerMessage(ctx, 'c1', { text: 'γεια' }, failDeps)).toEqual({
      payload: { ok: false, error: 'customer_not_found' }, status: 404,
    });
  });

  it('no_phone (400) when the customer has no phone column set', async () => {
    const ctx = fakeCtx((t) => (t === 'customers'
      ? { data: { phone: null, mobile_phone: null, landline_phone: null, preferred_contact_method: 'sms' } }
      : { data: null }));
    expect(await sendCustomerMessage(ctx, 'c1', { text: 'γεια' }, failDeps)).toEqual({
      payload: { ok: false, error: 'no_phone' }, status: 400,
    });
  });
});

describe('sendCustomerMessage — send (parity)', () => {
  it('send_failed (502, +reason) when the send returns channel none', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: custRow } : { data: null }));
    const deps = okDeps({ ok: false, channel: 'none', fallbackApplied: true, reason: 'missing_apifon_config' });
    expect(await sendCustomerMessage(ctx, 'c1', { text: 'γεια' }, deps)).toEqual({
      payload: { ok: false, error: 'send_failed', reason: 'missing_apifon_config' }, status: 502,
    });
  });

  it("send_failed reason defaults to 'unknown' when absent", async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: custRow } : { data: null }));
    const deps = okDeps({ ok: false, channel: 'none', fallbackApplied: false });
    expect(await sendCustomerMessage(ctx, 'c1', { text: 'γεια' }, deps)).toEqual({
      payload: { ok: false, error: 'send_failed', reason: 'unknown' }, status: 502,
    });
  });

  it('ok (200) with channel + fallbackApplied, logging the timeline with provider ids', async () => {
    const sink: { recorded?: Record<string, unknown> } = {};
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: custRow } : { data: null }));
    const deps = okDeps({ ok: true, channel: 'viber', viber: sentDetail, fallbackApplied: false }, sink);
    const res = await sendCustomerMessage(ctx, 'c1', { text: 'γεια' }, deps);
    expect(res).toEqual({
      payload: { ok: true, channel: 'viber', fallbackApplied: false }, status: 200,
    });
    expect(sink.recorded).toMatchObject({
      channel: 'viber', summary: 'γεια', providerRequestId: 'rq1', providerMessageId: 'mg1', workFolderId: null,
    });
  });

  it('tags the work folder when it belongs to the business + customer', async () => {
    const sink: { recorded?: Record<string, unknown> } = {};
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: custRow };
      if (t === 'work_folders') return { data: { id: 'wf1' } };
      return { data: null };
    });
    const deps = okDeps({ ok: true, channel: 'sms', sms: sentDetail, fallbackApplied: true }, sink);
    const res = await sendCustomerMessage(ctx, 'c1', { text: 'γεια', workFolderId: 'wf1' }, deps);
    expect(res).toEqual({
      payload: { ok: true, channel: 'sms', fallbackApplied: true }, status: 200,
    });
    expect(sink.recorded).toMatchObject({ workFolderId: 'wf1', channel: 'sms' });
  });

  it('does NOT tag a work folder that fails the ownership check', async () => {
    const sink: { recorded?: Record<string, unknown> } = {};
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: custRow };
      if (t === 'work_folders') return { data: null };
      return { data: null };
    });
    const deps = okDeps({ ok: true, channel: 'viber', viber: sentDetail, fallbackApplied: false }, sink);
    await sendCustomerMessage(ctx, 'c1', { text: 'γεια', workFolderId: 'wf1' }, deps);
    expect(sink.recorded).toMatchObject({ workFolderId: null });
  });
});
