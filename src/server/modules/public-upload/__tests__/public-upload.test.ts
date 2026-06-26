import { describe, it, expect, vi } from 'vitest';
import {
  mintSignedUploadUrl,
  recordUpload,
  resolveNotFoundReason,
  publicUploadConfig,
} from '../public-upload.service';
import type { RepoContext } from '../public-upload.repo';
import type { UploadTokenRow } from '../../../../lib/server/upload-tokens';

// Hermetic fake of the SERVICE-ROLE client (ctx.supabase). These public routes are NOT
// business-user-authenticated — the businessId/customerId come from the VERIFIED token
// row (passed in), and every query runs on this service client. The token verify
// (findValidUploadToken), the token-lifecycle marks and the push send are NOT exercised
// here (they live in / are injected by the route); these tests cover only the post-verify
// validation/guard throws and the storage/DB result handling.
//
// `resolve(table, op)` decides what each builder chain resolves to:
//   - status read  → from(t).select().eq().maybeSingle()
//   - session/comm INSERT → from(t).insert() (bare await)
//   - storage createSignedUploadUrl → storageResolve(bucket, path)
type Res = { data?: unknown; error?: unknown };

interface FB {
  select(c?: string): FB;
  eq(a?: unknown, b?: unknown): FB;
  maybeSingle(): Promise<Res>;
  insert(values?: unknown): Promise<Res>;
}

function fakeCtx(
  resolve: (table: string, op: string) => Res,
  storageResolve: () => Res = () => ({ data: null, error: new Error('unused') }),
): RepoContext {
  const supabase = {
    from(table: string): FB {
      const b: FB = {
        select() { return b; },
        eq() { return b; },
        maybeSingle() { return Promise.resolve(resolve(table, 'select')); },
        insert() { return Promise.resolve(resolve(table, 'insert')); },
      };
      return b;
    },
    storage: {
      from() {
        return {
          createSignedUploadUrl() { return Promise.resolve(storageResolve()); },
        };
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any };
}

const tokenRow: UploadTokenRow = {
  id: 'tok1',
  business_id: 'b1',
  customer_id: 'c1',
  token_hash: 'hash',
  status: 'opened',
  sent_channel: 'viber',
  sent_to_phone: null,
  expires_at: '2026-07-01T00:00:00.000Z',
  opened_at: null,
  completed_at: null,
  revoked_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// publicUploadConfig (GET 200 body)
// ---------------------------------------------------------------------------
describe('publicUploadConfig', () => {
  it('returns the public config with the lib constants', () => {
    expect(publicUploadConfig()).toEqual({
      maxFiles: 10,
      maxFileSizeBytes: 52_428_800,
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/heic',
        'image/heif',
        'image/webp',
        'video/mp4',
        'video/quicktime',
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// resolveNotFoundReason (GET 404 reason)
// ---------------------------------------------------------------------------
describe('resolveNotFoundReason', () => {
  it("returns 'completed' when the row status is completed", async () => {
    const ctx = fakeCtx(() => ({ data: { status: 'completed' }, error: null }));
    await expect(resolveNotFoundReason(ctx, 'raw')).resolves.toBe('completed');
  });
  it("returns 'invalid' when no row exists", async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(resolveNotFoundReason(ctx, 'raw')).resolves.toBe('invalid');
  });
  it("returns 'invalid' for any non-completed status", async () => {
    const ctx = fakeCtx(() => ({ data: { status: 'revoked' }, error: null }));
    await expect(resolveNotFoundReason(ctx, 'raw')).resolves.toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// mintSignedUploadUrl (signed-url)
// ---------------------------------------------------------------------------
describe('mintSignedUploadUrl (parity, pre/post-effect)', () => {
  it('invalid_body 400 on a non-object body', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(mintSignedUploadUrl(ctx, tokenRow, null)).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(mintSignedUploadUrl(ctx, tokenRow, [])).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(mintSignedUploadUrl(ctx, tokenRow, 'x')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });

  it('missing_fields 400 when filename/mimeType/sizeBytes missing', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(mintSignedUploadUrl(ctx, tokenRow, {})).rejects.toMatchObject({ code: 'missing_fields', status: 400 });
    await expect(mintSignedUploadUrl(ctx, tokenRow, { filename: 'a.jpg', mimeType: 'image/jpeg' }))
      .rejects.toMatchObject({ code: 'missing_fields', status: 400 });
  });

  it('invalid_mime_type 422 / file_too_large 422 / empty_file 422', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(mintSignedUploadUrl(ctx, tokenRow, { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 10 }))
      .rejects.toMatchObject({ code: 'invalid_mime_type', status: 422 });
    await expect(mintSignedUploadUrl(ctx, tokenRow, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 60_000_000 }))
      .rejects.toMatchObject({ code: 'file_too_large', status: 422 });
    await expect(mintSignedUploadUrl(ctx, tokenRow, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 0 }))
      .rejects.toMatchObject({ code: 'empty_file', status: 422 });
  });

  it('storage_unavailable 503 when the Storage call errors', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }), () => ({ data: null, error: { message: 'down' } }));
    await expect(mintSignedUploadUrl(ctx, tokenRow, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }))
      .rejects.toMatchObject({ code: 'storage_unavailable', status: 503 });
  });

  it('maps the minted signed URL into the result shape', async () => {
    const ctx = fakeCtx(
      () => ({ data: null, error: null }),
      () => ({ data: { signedUrl: 'https://s/u', path: 'b1/c1/tok1/a_x.jpg', token: 'st' }, error: null }),
    );
    await expect(mintSignedUploadUrl(ctx, tokenRow, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }))
      .resolves.toEqual({ uploadUrl: 'https://s/u', uploadPath: 'b1/c1/tok1/a_x.jpg', token: 'st' });
  });
});

// ---------------------------------------------------------------------------
// recordUpload (complete)
// ---------------------------------------------------------------------------
describe('recordUpload (parity, pre/post-effect)', () => {
  it('invalid_body 400 on a non-object body', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(recordUpload(ctx, tokenRow, null)).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(recordUpload(ctx, tokenRow, [])).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });

  it('invalid_files 400 when files empty / not array / over the cap', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(recordUpload(ctx, tokenRow, { files: [] })).rejects.toMatchObject({ code: 'invalid_files', status: 400 });
    await expect(recordUpload(ctx, tokenRow, { files: 'x' })).rejects.toMatchObject({ code: 'invalid_files', status: 400 });
    const tooMany = Array.from({ length: 11 }, () => ({}));
    await expect(recordUpload(ctx, tokenRow, { files: tooMany })).rejects.toMatchObject({ code: 'invalid_files', status: 400 });
  });

  it('invalid_file_entry 400 on a non-object entry or missing fields', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(recordUpload(ctx, tokenRow, { files: [null] }))
      .rejects.toMatchObject({ code: 'invalid_file_entry', status: 400 });
    await expect(recordUpload(ctx, tokenRow, { files: [{ uploadPath: 'b1/c1/tok1/x.jpg', name: 'x.jpg' }] }))
      .rejects.toMatchObject({ code: 'invalid_file_entry', status: 400 });
  });

  it('invalid_upload_path 403 when the path is outside the token prefix', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(recordUpload(ctx, tokenRow, {
      files: [{ uploadPath: 'other/c1/tok1/x.jpg', name: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    })).rejects.toMatchObject({ code: 'invalid_upload_path', status: 403 });
  });

  it('invalid_mime_type 422 when an entry has a disallowed mime type', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(recordUpload(ctx, tokenRow, {
      files: [{ uploadPath: 'b1/c1/tok1/x.txt', name: 'x.txt', mimeType: 'text/plain', sizeBytes: 10 }],
    })).rejects.toMatchObject({ code: 'invalid_mime_type', status: 422 });
  });

  it('server_error 500 when the session insert errors', async () => {
    const ctx = fakeCtx((t, op) =>
      t === 'customer_upload_sessions' && op === 'insert'
        ? { data: null, error: { message: 'boom' } }
        : { data: null, error: null },
    );
    await expect(recordUpload(ctx, tokenRow, {
      files: [{ uploadPath: 'b1/c1/tok1/x.jpg', name: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    })).rejects.toMatchObject({ code: 'server_error', status: 500 });
  });

  it('returns { ok: true } and marks completed when no comment is present', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    const markCompleted = vi.fn(async () => {});
    const sendPush = vi.fn(async () => {});
    await expect(recordUpload(ctx, tokenRow, {
      files: [{ uploadPath: 'b1/c1/tok1/x.jpg', name: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    }, { markCompleted, sendPush })).resolves.toEqual({ ok: true });
    expect(markCompleted).toHaveBeenCalledWith('tok1');
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('sends the push (default viber channel) when a comment is present', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    const sendPush = vi.fn(async () => {});
    await expect(recordUpload(ctx, tokenRow, {
      customerComment: 'γεια',
      files: [{ uploadPath: 'b1/c1/tok1/x.jpg', name: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    }, { markCompleted: vi.fn(async () => {}), sendPush })).resolves.toEqual({ ok: true });
    expect(sendPush).toHaveBeenCalledWith('b1', {
      title: 'Νέο μήνυμα από πελάτη',
      body: 'Σχόλιο από ανέβασμα φωτογραφιών: γεια',
      url: '/customers/c1',
      data: { type: 'customer_message', source: 'upload' },
    });
  });

  it('a markCompleted throw is non-fatal (still returns { ok: true })', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    const markCompleted = vi.fn(async () => { throw new Error('mark down'); });
    await expect(recordUpload(ctx, tokenRow, {
      files: [{ uploadPath: 'b1/c1/tok1/x.jpg', name: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    }, { markCompleted })).resolves.toEqual({ ok: true });
  });
});
