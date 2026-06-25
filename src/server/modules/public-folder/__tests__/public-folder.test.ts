// Hermetic parity tests for the public-folder service. These exercise the
// POST-VERIFICATION DB/logic branches with a fake service-role client — the token
// verify (findValidFolderToken), real push (inert in test: no service account →
// isPushEnabled() false), AI, storage and the upload-token mint are NOT exercised.
//
// Focus: the exact error code + HTTP status each branch returns, plus one main
// (success) path per action where it stays hermetic.

import { describe, it, expect } from 'vitest';
import {
  logFolderQuestion,
  listPublicFolderMessages,
  respondToFolderOffer,
  respondToFolderAppointment,
  declareFolderPayment,
  createFolderUploadLink,
} from '../public-folder.service';
import type { PublicFolderContext } from '../public-folder.types';

type Res = { data?: unknown; error?: unknown };

// A minimal thenable Supabase query builder: every chained method returns the
// same builder, and awaiting it (or .maybeSingle()) resolves to a per-table Res.
interface FB {
  select(c?: string): FB;
  insert(v?: unknown): FB;
  update(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB;
  is(a?: unknown, b?: unknown): FB;
  order(a?: unknown, b?: unknown): FB;
  limit(n?: unknown): FB;
  maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}

function fakeCtx(resolve: (table: string) => Res): PublicFolderContext {
  function from(table: string): FB {
    const ret = () => (): FB => b;
    const b: FB = {
      select: ret(), insert: ret(), update: ret(), eq: ret(), in: ret(),
      is: ret(), order: ret(), limit: ret(), maybeSingle: ret(),
      then: (r) => r(resolve(table)),
    };
    return b;
  }
  return {
    supabase: { from } as unknown as PublicFolderContext['supabase'],
    businessId: 'b1',
    workFolderId: 'wf1',
    tokenId: 't1',
    sentChannel: 'sms',
  };
}

describe('logFolderQuestion (message POST parity)', () => {
  it('folder_message_failed (500) when the folder lookup errors', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    const res = await logFolderQuestion(ctx, 'hi');
    expect(res).toEqual({ ok: false, error: 'folder_message_failed', status: 500 });
  });

  it('folder_not_found (404) when no folder row matches the token scope', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    const res = await logFolderQuestion(ctx, 'hi');
    expect(res).toEqual({ ok: false, error: 'folder_not_found', status: 404 });
  });

  it('folder_message_failed (500) when the communications insert errors', async () => {
    const ctx = fakeCtx((table) =>
      table === 'work_folders'
        ? { data: { customer_id: 'c1', title: 'Job' } }
        : { error: { message: 'insert failed' } },
    );
    const res = await logFolderQuestion(ctx, 'hi');
    expect(res).toEqual({ ok: false, error: 'folder_message_failed', status: 500 });
  });

  it('null (success → route { ok:true }) when the row is logged + owner notified', async () => {
    const ctx = fakeCtx((table) =>
      table === 'work_folders' ? { data: { customer_id: 'c1', title: 'Job' } } : { error: null },
    );
    const calls: unknown[] = [];
    const res = await logFolderQuestion(ctx, 'hi', {
      notifyOwner: async (b, p) => { calls.push([b, p]); },
    });
    expect(res).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('listPublicFolderMessages (message GET parity)', () => {
  it('folder_messages_failed (500) when the thread query errors', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    const res = await listPublicFolderMessages(ctx);
    expect(res).toEqual({ ok: false, error: 'folder_messages_failed', status: 500 });
  });

  it('maps the safe thread shape and drops call rows on success', async () => {
    const rows = [
      { direction: 'outbound', channel: 'sms', summary: ' Reply ', created_at: '2026-01-01T00:00:00Z' },
      { direction: 'inbound', channel: 'call', summary: 'AI brief', created_at: '2026-01-01T00:01:00Z' },
      { direction: 'inbound', channel: 'sms', summary: '', created_at: '2026-01-01T00:02:00Z' },
    ];
    const ctx = fakeCtx((table) => (table === 'communications' ? { data: rows } : { error: null }));
    const res = await listPublicFolderMessages(ctx);
    expect(res).toEqual({
      ok: true,
      messages: [{ direction: 'out', text: 'Reply', createdAt: '2026-01-01T00:00:00Z' }],
    });
  });
});

const offerDeps = { applyOfferResponse: async () => ({ ok: false, httpStatus: 500, error: 'x' }) };
const apptDeps = { applyAppointmentResponse: async () => ({ ok: false, httpStatus: 500, error: 'x' }) };

describe('respondToFolderOffer (offer/accept parity)', () => {
  it('offer_response_failed (500) when the offer fetch errors', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    const res = await respondToFolderOffer(ctx, 'o1', 'accepted', null, offerDeps);
    expect(res).toEqual({ ok: false, error: 'offer_response_failed', status: 500 });
  });

  it('offer_not_found (404) when no offer matches the token scope', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    const res = await respondToFolderOffer(ctx, 'o1', 'accepted', null, offerDeps);
    expect(res).toEqual({ ok: false, error: 'offer_not_found', status: 404 });
  });

  it('passes the lib result through verbatim on success (tokenId omitted, folder stamped)', async () => {
    const ctx = fakeCtx(() => ({ data: { id: 'o1', customer_id: 'c1', offer_number: 'P-1', status: 'sent_provider', valid_until: null, notes: null, total: 100 } }));
    let seen: { tokenId?: string | null; workFolderId?: string | null } | null = null;
    const res = await respondToFolderOffer(ctx, 'o1', 'accepted', null, {
      applyOfferResponse: async (opts) => {
        seen = { tokenId: opts.tokenId, workFolderId: opts.workFolderId };
        return { ok: true, httpStatus: 200, offerNumber: 'P-1', status: 'accepted', total: 100 };
      },
    });
    expect(res).toEqual({ ok: true, offerNumber: 'P-1', status: 'accepted', total: 100 });
    expect(seen).toEqual({ tokenId: undefined, workFolderId: 'wf1' });
  });
});

describe('respondToFolderAppointment (appointment/respond parity)', () => {
  it('appointment_response_failed (500) when the task fetch errors', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    const res = await respondToFolderAppointment(ctx, 'tk1', 'accepted', null, null, null, apptDeps);
    expect(res).toEqual({ ok: false, error: 'appointment_response_failed', status: 500 });
  });

  it('appointment_not_found (404) for a non-appointment task type', async () => {
    const ctx = fakeCtx(() => ({ data: { id: 'tk1', type: 'call_back', status: 'open', due_date: null, due_time: null, title: 'x', customer_id: 'c1', note: null } }));
    const res = await respondToFolderAppointment(ctx, 'tk1', 'accepted', null, null, null, apptDeps);
    expect(res).toEqual({ ok: false, error: 'appointment_not_found', status: 404 });
  });

  it('appointment_not_found (404) when no task matches the token scope', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    const res = await respondToFolderAppointment(ctx, 'tk1', 'accepted', null, null, null, apptDeps);
    expect(res).toEqual({ ok: false, error: 'appointment_not_found', status: 404 });
  });
});

describe('declareFolderPayment (payment parity)', () => {
  it('payment_declare_failed (500) when the atomic update errors', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    const res = await declareFolderPayment(ctx, 'pr1');
    expect(res).toEqual({ ok: false, error: 'payment_declare_failed', status: 500 });
  });

  it('payment_not_actionable (409) when 0 rows transitioned pending→declared', async () => {
    const ctx = fakeCtx(() => ({ data: [] }));
    const res = await declareFolderPayment(ctx, 'pr1');
    expect(res).toEqual({ ok: false, error: 'payment_not_actionable', status: 409 });
  });

  it('null (success → route { ok:true }) when one row transitioned', async () => {
    const ctx = fakeCtx(() => ({ data: [{ id: 'pr1', customer_id: 'c1' }] }));
    const res = await declareFolderPayment(ctx, 'pr1');
    expect(res).toBeNull();
  });
});

describe('createFolderUploadLink (upload-link parity)', () => {
  const uploadDeps = { createUploadToken: async () => ({ uploadUrl: 'https://x/upload/tok' }) };

  it('upload_link_failed (500) when the folder lookup errors', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    const res = await createFolderUploadLink(ctx, uploadDeps);
    expect(res).toEqual({ ok: false, error: 'upload_link_failed', status: 500 });
  });

  it('folder_not_found (404) when no folder row / no customer_id', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    const res = await createFolderUploadLink(ctx, uploadDeps);
    expect(res).toEqual({ ok: false, error: 'folder_not_found', status: 404 });
  });

  it('returns the minted upload url on success', async () => {
    const ctx = fakeCtx(() => ({ data: { customer_id: 'c1' } }));
    const res = await createFolderUploadLink(ctx, uploadDeps);
    expect(res).toEqual({ ok: true, url: 'https://x/upload/tok' });
  });
});
