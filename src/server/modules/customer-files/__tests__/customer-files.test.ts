import { describe, it, expect } from 'vitest';
import {
  completeUpload,
  createUploadUrl,
  getSignedUrl,
  getSignedUrls,
} from '../customer-files.service';
import type { RepoContext } from '../customer-files.repo';

// Hermetic fake of the AUTH-SCOPED service-role client (ctx.supabase). Only the
// auth-scoped reads (customers / customer_upload_sessions, via tenantDb) and the
// auth-scoped Storage view-URL calls flow through here; the upload-token mint and
// session INSERT use a SEPARATE service client (createServiceSupabaseClient) and so
// are intentionally NOT exercised — these tests cover only the pure validation/guard
// throws (and the hermetic auth-scoped reads) BEFORE any service-client/Storage effect.
//
// `resolve(table, ops)` decides what each builder chain resolves to. The builder records
// the chained ops and resolves at `.maybeSingle()` (single read) or `.then()` (bare await,
// e.g. the batch `.in(...).eq(...)` select).
type Res = { data?: unknown; error?: unknown };
interface FB {
  select(c?: string): FB;
  eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB;
  maybeSingle(): Promise<Res>;
  then(onF: (r: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Record<string, unknown>) => Res): RepoContext {
  const supabase = {
    from(table: string): FB {
      const ops: Record<string, unknown> = { table };
      const b: FB = {
        select(c?: string) { ops.select = c; return b; },
        eq(a?: unknown, v?: unknown) { (ops.eq ??= []); (ops.eq as unknown[]).push([a, v]); return b; },
        in(a?: unknown, v?: unknown) { ops.in = [a, v]; return b; },
        maybeSingle() { return Promise.resolve(resolve(table, ops)); },
        then(onF: (r: Res) => unknown) { return Promise.resolve(resolve(table, ops)).then(onF); },
      };
      return b;
    },
    storage: {
      // Never reached in these tests (all stop before the Storage effect).
      from() {
        return {
          createSignedUrl() { return Promise.resolve({ data: null, error: new Error('unused') }); },
          createSignedUrls() { return Promise.resolve({ data: null, error: new Error('unused') }); },
        };
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: supabase as any };
}

const okCustomer = (table: string): Res =>
  table === 'customers' ? { data: { id: 'c1' }, error: null } : { data: null, error: null };

// ---------------------------------------------------------------------------
// createUploadUrl (upload-url)
// ---------------------------------------------------------------------------
describe('createUploadUrl (parity, pre-effect)', () => {
  it('invalid_body 400 on non-object body', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createUploadUrl(ctx, null, 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(createUploadUrl(ctx, [], 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(createUploadUrl(ctx, 'x', 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });

  it('missing_fields 400 when filename/mimeType/sizeBytes missing', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createUploadUrl(ctx, {}, 'c1')).rejects.toMatchObject({ code: 'missing_fields', status: 400 });
    await expect(createUploadUrl(ctx, { filename: 'a.jpg', mimeType: 'image/jpeg' }, 'c1'))
      .rejects.toMatchObject({ code: 'missing_fields', status: 400 });
  });

  it('invalid_mime_type 422 on a disallowed mime type', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createUploadUrl(ctx, { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 10 }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_mime_type', status: 422 });
  });

  it('file_too_large 422 / empty_file 422', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createUploadUrl(ctx, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 60_000_000 }, 'c1'))
      .rejects.toMatchObject({ code: 'file_too_large', status: 422 });
    await expect(createUploadUrl(ctx, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 0 }, 'c1'))
      .rejects.toMatchObject({ code: 'empty_file', status: 422 });
  });

  it('server_error 500 when the customer read errors', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: { message: 'boom' } }));
    await expect(createUploadUrl(ctx, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }, 'c1'))
      .rejects.toMatchObject({ code: 'server_error', status: 500 });
  });

  it('customer_not_found 404 when the customer is missing/other-tenant', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createUploadUrl(ctx, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }, 'c1'))
      .rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
});

// ---------------------------------------------------------------------------
// completeUpload (complete)
// ---------------------------------------------------------------------------
describe('completeUpload (parity, pre-effect)', () => {
  it('invalid_body 400 on non-object body', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(completeUpload(ctx, null, 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(completeUpload(ctx, [], 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });

  it('missing_fields 400 when uploadTokenId missing', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(completeUpload(ctx, { files: [{}] }, 'c1'))
      .rejects.toMatchObject({ code: 'missing_fields', status: 400 });
  });

  it('invalid_files 400 when files empty / not array / over the cap', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(completeUpload(ctx, { uploadTokenId: 't1', files: [] }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_files', status: 400 });
    await expect(completeUpload(ctx, { uploadTokenId: 't1', files: 'x' }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_files', status: 400 });
    const tooMany = Array.from({ length: 11 }, () => ({}));
    await expect(completeUpload(ctx, { uploadTokenId: 't1', files: tooMany }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_files', status: 400 });
  });

  it('server_error 500 when the customer read errors', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: { message: 'boom' } }));
    await expect(completeUpload(ctx, { uploadTokenId: 't1', files: [{ path: 'p' }] }, 'c1'))
      .rejects.toMatchObject({ code: 'server_error', status: 500 });
  });

  it('customer_not_found 404 when the customer is missing/other-tenant', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(completeUpload(ctx, { uploadTokenId: 't1', files: [{ path: 'p' }] }, 'c1'))
      .rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
});

// ---------------------------------------------------------------------------
// getSignedUrl (signed-url)
// ---------------------------------------------------------------------------
describe('getSignedUrl (parity, pre-effect)', () => {
  it('invalid_body 400 on non-object body or missing sessionId', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(getSignedUrl(ctx, null, 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(getSignedUrl(ctx, {}, 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });

  it('invalid_file_index 400 on a non-integer / negative index', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(getSignedUrl(ctx, { sessionId: 's1', fileIndex: -1 }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_file_index', status: 400 });
    await expect(getSignedUrl(ctx, { sessionId: 's1', fileIndex: 1.5 }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_file_index', status: 400 });
    await expect(getSignedUrl(ctx, { sessionId: 's1', fileIndex: 'x' }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_file_index', status: 400 });
  });

  it('server_error 500 when the session read errors', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: { message: 'boom' } }));
    await expect(getSignedUrl(ctx, { sessionId: 's1', fileIndex: 0 }, 'c1'))
      .rejects.toMatchObject({ code: 'server_error', status: 500 });
  });

  it('session_not_found 404 when the session is missing/other-tenant', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(getSignedUrl(ctx, { sessionId: 's1', fileIndex: 0 }, 'c1'))
      .rejects.toMatchObject({ code: 'session_not_found', status: 404 });
  });

  it('invalid_file_index 400 when the index is out of range', async () => {
    const ctx = fakeCtx(() => ({ data: { files: [] }, error: null }));
    await expect(getSignedUrl(ctx, { sessionId: 's1', fileIndex: 0 }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_file_index', status: 400 });
  });

  it('server_error 500 when the stored entry is malformed', async () => {
    const ctx = fakeCtx(() => ({ data: { files: [{ path: 'p' }] }, error: null }));
    await expect(getSignedUrl(ctx, { sessionId: 's1', fileIndex: 0 }, 'c1'))
      .rejects.toMatchObject({ code: 'server_error', status: 500 });
  });
});

// ---------------------------------------------------------------------------
// getSignedUrls (signed-urls)
// ---------------------------------------------------------------------------
describe('getSignedUrls (parity, pre-effect)', () => {
  it('invalid_body 400 on a non-array / empty / over-cap sessionIds', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(getSignedUrls(ctx, null, 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(getSignedUrls(ctx, { sessionIds: [] }, 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(getSignedUrls(ctx, { sessionIds: 'x' }, 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    const tooMany = Array.from({ length: 21 }, (_, i) => `s${i}`);
    await expect(getSignedUrls(ctx, { sessionIds: tooMany }, 'c1')).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });

  it('invalid_body 400 when every id is blank/non-string', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(getSignedUrls(ctx, { sessionIds: ['', '   ', 5] }, 'c1'))
      .rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });

  it('server_error 500 when the session read errors', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: { message: 'boom' } }));
    await expect(getSignedUrls(ctx, { sessionIds: ['s1'] }, 'c1'))
      .rejects.toMatchObject({ code: 'server_error', status: 500 });
  });

  it('returns { files: [] } when no valid file entries (no Storage call)', async () => {
    const ctx = fakeCtx(() => ({ data: [{ id: 's1', files: [] }], error: null }));
    await expect(getSignedUrls(ctx, { sessionIds: ['s1'] }, 'c1')).resolves.toEqual({ files: [] });
  });

  it('returns { files: [] } when sessions have only malformed entries', async () => {
    const ctx = fakeCtx(() => ({ data: [{ id: 's1', files: [{ path: 'p' }, 5] }], error: null }));
    await expect(getSignedUrls(ctx, { sessionIds: ['s1'] }, 'c1')).resolves.toEqual({ files: [] });
  });
});
