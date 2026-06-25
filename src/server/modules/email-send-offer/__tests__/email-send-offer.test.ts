import { describe, it, expect } from 'vitest';
import { sendOfferEmail, type SendOfferConfig, type SendOfferDeps } from '../email-send-offer.service';
import type { RepoContext } from '../email-send-offer.repo';

// ---------------------------------------------------------------------------
// Hermetic fakes.
//
// The covered branches exercise ONLY the post-auth validation + the open-relay
// recipient guard (which fire BEFORE the Resend provider call) plus one happy
// path where the provider `fetch` and the timeline logger are INJECTED stubs —
// the real Resend call / recordOutboundMessage are never reached. `resolve(table,
// ops)` returns `{ data?, error? }` per builder chain, keyed by table; the builder
// records ops and is thenable so the repo's `await from(t).select()…maybeSingle()`
// resolves to it. A builder may also `throw` to simulate a DB rejection.
// ---------------------------------------------------------------------------

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB;
  eq(a?: unknown, b?: unknown): FB;
  ilike(a?: unknown, b?: unknown): FB;
  limit(n?: number): FB;
  update(v?: unknown): FB;
  maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}

function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), eq: rec('eq'), ilike: rec('ilike'), limit: rec('limit'),
      update: rec('update'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const config: SendOfferConfig = { apiKey: 'rk_test', from: 'noreply@opiflow.gr', replyToEnv: undefined };

// Deps whose effects must never run in the validation/guard tests.
const failDeps: SendOfferDeps = {
  recordOutboundMessage: async () => { throw new Error('recordOutboundMessage must not be called'); },
  fetchImpl: (async () => { throw new Error('fetch must not be called'); }) as unknown as typeof fetch,
};

const validBody = { to: 'a@b.com', subject: 'Προσφορά', text: 'σώμα', offerId: 'o1' };

describe('sendOfferEmail — validation + guards (parity)', () => {
  it('invalid_body (400) for a non-object body', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    expect(await sendOfferEmail(ctx, null, config, failDeps)).toEqual({
      payload: { ok: false, error: 'invalid_body' }, status: 400,
    });
    expect(await sendOfferEmail(ctx, 'x', config, failDeps)).toEqual({
      payload: { ok: false, error: 'invalid_body' }, status: 400,
    });
  });

  it('invalid_email (400) for a malformed recipient', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    expect(await sendOfferEmail(ctx, { ...validBody, to: 'not-an-email' }, config, failDeps)).toEqual({
      payload: { ok: false, error: 'invalid_email' }, status: 400,
    });
    expect(await sendOfferEmail(ctx, { ...validBody, to: 42 }, config, failDeps)).toEqual({
      payload: { ok: false, error: 'invalid_email' }, status: 400,
    });
  });

  it('recipient_not_allowed (403) when no own-customer matches', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: null }));
    expect(await sendOfferEmail(ctx, validBody, config, failDeps)).toEqual({
      payload: { ok: false, error: 'recipient_not_allowed' }, status: 403,
    });
  });

  it('recipient_check_failed (500) when the customer lookup rejects', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'customers') throw new Error('db down');
      return { data: null };
    });
    expect(await sendOfferEmail(ctx, validBody, config, failDeps)).toEqual({
      payload: { ok: false, error: 'recipient_check_failed' }, status: 500,
    });
  });

  it('missing_subject (400) after a matched recipient', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: { id: 'c1' } } : { data: null }));
    expect(await sendOfferEmail(ctx, { ...validBody, subject: '   ' }, config, failDeps)).toEqual({
      payload: { ok: false, error: 'missing_subject' }, status: 400,
    });
  });

  it('missing_body (400) when neither text nor html has content', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: { id: 'c1' } } : { data: null }));
    expect(await sendOfferEmail(ctx, { to: 'a@b.com', subject: 'S' }, config, failDeps)).toEqual({
      payload: { ok: false, error: 'missing_body' }, status: 400,
    });
  });
});

describe('sendOfferEmail — provider call (parity)', () => {
  it('provider_error (502) when Resend responds non-ok', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'businesses') return { data: { name: 'Biz', email: null } };
      return { data: null };
    });
    const fetchImpl = (async () => ({ ok: false, json: async () => ({ message: 'bad' }) })) as unknown as typeof fetch;
    const deps: SendOfferDeps = { recordOutboundMessage: async () => ({ communicationId: null }), fetchImpl };
    expect(await sendOfferEmail(ctx, validBody, config, deps)).toEqual({
      payload: { ok: false, error: 'provider_error' }, status: 502,
    });
  });

  it('ok (200) with the provider id, advancing a draft offer and logging the timeline', async () => {
    let recorded = false;
    let offerUpdated = false;
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'businesses') return { data: { name: 'Biz', email: 'biz@x.com' } };
      if (t === 'offers') {
        if (ops.some((o) => o.m === 'update')) { offerUpdated = true; return { data: null }; }
        return { data: { id: 'o1', status: 'draft' } };
      }
      return { data: null };
    });
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ id: 'email_123' }) })) as unknown as typeof fetch;
    const deps: SendOfferDeps = {
      recordOutboundMessage: async () => { recorded = true; return { communicationId: 'k1' }; },
      fetchImpl,
    };
    expect(await sendOfferEmail(ctx, validBody, config, deps)).toEqual({
      payload: { ok: true, id: 'email_123' }, status: 200,
    });
    expect(offerUpdated).toBe(true);
    expect(recorded).toBe(true);
  });

  it('email_timeout (504) when the provider call aborts', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'businesses') return { data: { name: 'Biz', email: null } };
      return { data: null };
    });
    const fetchImpl = (async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }) as unknown as typeof fetch;
    const deps: SendOfferDeps = { recordOutboundMessage: async () => ({ communicationId: null }), fetchImpl };
    expect(await sendOfferEmail(ctx, validBody, config, deps)).toEqual({
      payload: { ok: false, error: 'email_timeout' }, status: 504,
    });
  });
});
