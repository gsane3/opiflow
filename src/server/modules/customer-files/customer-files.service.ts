// Customer files — service (explicit validation + orchestration). Parity-matched to
// the four /api/customers/[id]/files routes.
//
// Each exported function is the BODY of one route after the 415 content-type guard and
// auth (which stay in the thin route). Validation throws AppError with the route's exact
// codes/statuses, preserving order and lenient coercions. The whole body is wrapped in a
// broad try/catch that converts any non-AppError throw to AppError('server_error', 500),
// mirroring the original `} catch { … server_error 500 }`. AppError is rethrown as-is so
// the explicit early-return codes (invalid_body, customer_not_found, …) survive unchanged.
//
// External effects (Supabase Storage signed URLs, manual-token mint) live in the repo via
// the existing upload-tokens lib; the service keeps them thin. The token "completed" mark
// is non-fatal exactly as in the live complete route.

import { AppError } from '../../core/errors';
import {
  ensureValidUploadFile,
  getUploadKind,
  markUploadTokenCompleted,
  MAX_FILES_PER_SESSION,
} from '../../../lib/server/upload-tokens';
import {
  createManualToken,
  createSignedUploadUrl,
  createSignedViewUrl,
  createSignedViewUrls,
  insertSession,
  selectCustomer,
  selectSessionFiles,
  selectSessionsFiles,
  selectUploadToken,
  type FileRecord,
  type InsertedSessionRow,
  type ManualTokenRow,
  type RepoContext,
} from './customer-files.repo';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface SessionFileEntry {
  path: string;
  name: string;
  mimeType: string;
  kind: string;
}

function isFileEntry(entry: unknown): entry is SessionFileEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as Record<string, unknown>).path === 'string' &&
    typeof (entry as Record<string, unknown>).name === 'string' &&
    typeof (entry as Record<string, unknown>).mimeType === 'string' &&
    typeof (entry as Record<string, unknown>).kind === 'string'
  );
}

const SIGNED_URL_TTL_SECONDS = 300;
const BATCH_MAX_SESSIONS = 20;
const BATCH_MAX_FILES = 200;
const BATCH_URL_TTL_SECONDS = 600;

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/files/upload-url
// ---------------------------------------------------------------------------

export interface UploadUrlResult {
  uploadUrl: string;
  uploadPath: string;
  token: string;
  uploadTokenId: string;
}

export async function createUploadUrl(
  ctx: RepoContext,
  body: unknown,
  customerId: string,
): Promise<UploadUrlResult> {
  try {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('invalid_body', 400);
    }
    const raw = body as Record<string, unknown>;

    const filename = str(raw.filename);
    const mimeType = str(raw.mimeType);
    const sizeBytes = typeof raw.sizeBytes === 'number' ? raw.sizeBytes : null;
    const reuseTokenId = str(raw.uploadTokenId);

    if (!filename || !mimeType || sizeBytes === null) {
      throw new AppError('missing_fields', 400);
    }

    const validation = ensureValidUploadFile({ filename, mimeType, sizeBytes });
    if (!validation.valid) {
      throw new AppError(validation.error, 422);
    }

    // Verify the customer belongs to this business (auth-scoped client).
    const { data: customerData, error: customerError } = await selectCustomer(ctx, customerId);
    if (customerError) {
      throw new AppError('server_error', 500);
    }
    if (!customerData) {
      throw new AppError('customer_not_found', 404);
    }

    const now = new Date().toISOString();

    // Resolve the manual upload token row (reuse across a batch, or create one).
    let token: ManualTokenRow;

    if (reuseTokenId) {
      const { data: existing, error: existingError } = await selectUploadToken(
        ctx.businessId,
        customerId,
        reuseTokenId,
      );
      if (existingError) {
        throw new AppError('server_error', 500);
      }
      if (!existing) {
        throw new AppError('upload_token_not_found', 404);
      }
      token = existing;
    } else {
      const { data: created, error: createError } = await createManualToken(
        ctx.businessId,
        customerId,
        now,
      );
      if (createError || !created) {
        throw new AppError('server_error', 500);
      }
      token = created;
    }

    // Build storage path + signed upload URL (identical to the public flow).
    const { data, error } = await createSignedUploadUrl(token, filename);

    if (error || !data) {
      throw new AppError('storage_unavailable', 503);
    }

    return {
      uploadUrl: data.signedUrl,
      uploadPath: data.path,
      token: data.token,
      uploadTokenId: token.id,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('server_error', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/files/complete
// ---------------------------------------------------------------------------

export async function completeUpload(
  ctx: RepoContext,
  body: unknown,
  customerId: string,
): Promise<{ session: InsertedSessionRow }> {
  try {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('invalid_body', 400);
    }
    const raw = body as Record<string, unknown>;

    const uploadTokenId = str(raw.uploadTokenId);
    if (!uploadTokenId) {
      throw new AppError('missing_fields', 400);
    }

    if (
      !Array.isArray(raw.files) ||
      raw.files.length === 0 ||
      raw.files.length > MAX_FILES_PER_SESSION
    ) {
      throw new AppError('invalid_files', 400);
    }

    // Verify the customer belongs to this business (auth-scoped client).
    const { data: customerData, error: customerError } = await selectCustomer(ctx, customerId);
    if (customerError) {
      throw new AppError('server_error', 500);
    }
    if (!customerData) {
      throw new AppError('customer_not_found', 404);
    }

    // Verify the upload token belongs to this customer + business, and derive
    // the expected storage-path prefix from it.
    const { data: tokenData, error: tokenError } = await selectUploadToken(
      ctx.businessId,
      customerId,
      uploadTokenId,
    );
    if (tokenError) {
      throw new AppError('server_error', 500);
    }
    if (!tokenData) {
      throw new AppError('upload_token_not_found', 404);
    }

    const expectedPrefix = `${ctx.businessId}/${customerId}/${uploadTokenId}/`;

    const files: FileRecord[] = [];

    for (const f of raw.files as unknown[]) {
      if (typeof f !== 'object' || f === null || Array.isArray(f)) {
        throw new AppError('invalid_file_entry', 400);
      }
      const fe = f as Record<string, unknown>;

      const path = str(fe.path);
      const name = str(fe.name);
      const mimeType = str(fe.mimeType);
      const sizeBytes = typeof fe.sizeBytes === 'number' ? fe.sizeBytes : null;

      if (!path || !name || !mimeType || sizeBytes === null) {
        throw new AppError('invalid_file_entry', 400);
      }

      if (!path.startsWith(expectedPrefix)) {
        throw new AppError('invalid_upload_path', 403);
      }

      const validation = ensureValidUploadFile({ filename: name, mimeType, sizeBytes });
      if (!validation.valid) {
        throw new AppError(validation.error, 422);
      }

      files.push({
        path,
        name,
        sizeBytes,
        mimeType,
        kind: getUploadKind(mimeType),
      });
    }

    const comment = str(raw.comment) ?? null;
    const now = new Date().toISOString();

    const { data: inserted, error: insertError } = await insertSession(
      ctx.businessId,
      customerId,
      uploadTokenId,
      files,
      comment,
      now,
    );

    if (insertError || !inserted) {
      throw new AppError('server_error', 500);
    }

    // Mark the manual token completed (non-fatal: session is already recorded).
    try {
      await markUploadTokenCompleted(uploadTokenId);
    } catch {
      // intentionally swallowed
    }

    return { session: inserted };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('server_error', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/files/signed-url
// ---------------------------------------------------------------------------

export interface SignedUrlResult {
  signedUrl: string;
  name: string;
  mimeType: string;
  kind: string;
}

export async function getSignedUrl(
  ctx: RepoContext,
  body: unknown,
  customerId: string,
): Promise<SignedUrlResult> {
  try {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('invalid_body', 400);
    }
    const raw = body as Record<string, unknown>;

    const sessionId = str(raw.sessionId);
    if (!sessionId) {
      throw new AppError('invalid_body', 400);
    }

    const fileIndex = raw.fileIndex;
    if (
      typeof fileIndex !== 'number' ||
      !Number.isInteger(fileIndex) ||
      fileIndex < 0
    ) {
      throw new AppError('invalid_file_index', 400);
    }

    const { data: sessionData, error: sessionError } = await selectSessionFiles(
      ctx,
      sessionId,
      customerId,
    );

    if (sessionError) {
      throw new AppError('server_error', 500);
    }
    if (!sessionData) {
      throw new AppError('session_not_found', 404);
    }

    const files = sessionData.files;
    if (!Array.isArray(files) || fileIndex >= files.length) {
      throw new AppError('invalid_file_index', 400);
    }

    const entry = files[fileIndex] as unknown;
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as Record<string, unknown>).path !== 'string' ||
      typeof (entry as Record<string, unknown>).name !== 'string' ||
      typeof (entry as Record<string, unknown>).mimeType !== 'string' ||
      typeof (entry as Record<string, unknown>).kind !== 'string'
    ) {
      throw new AppError('server_error', 500);
    }

    const fileEntry = entry as SessionFileEntry;

    const { data: signedData, error: storageError } = await createSignedViewUrl(
      ctx,
      fileEntry.path,
      SIGNED_URL_TTL_SECONDS,
    );

    if (storageError || !signedData) {
      throw new AppError('storage_unavailable', 503);
    }

    return {
      signedUrl: signedData.signedUrl,
      name: fileEntry.name,
      mimeType: fileEntry.mimeType,
      kind: fileEntry.kind,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('server_error', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/files/signed-urls
// ---------------------------------------------------------------------------

export interface SignedUrlBatchEntry {
  sessionId: string;
  fileIndex: number;
  signedUrl: string | null;
  name: string;
  mimeType: string;
  kind: string;
}

export async function getSignedUrls(
  ctx: RepoContext,
  body: unknown,
  customerId: string,
): Promise<{ files: SignedUrlBatchEntry[] }> {
  try {
    const rawIds = (body as Record<string, unknown> | null)?.sessionIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > BATCH_MAX_SESSIONS) {
      throw new AppError('invalid_body', 400);
    }
    const sessionIds = rawIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (sessionIds.length === 0) {
      throw new AppError('invalid_body', 400);
    }

    const { data: sessionRows, error: sessionError } = await selectSessionsFiles(
      ctx,
      sessionIds,
      customerId,
    );

    if (sessionError) {
      throw new AppError('server_error', 500);
    }

    // Collect every valid file entry (session order preserved) up to BATCH_MAX_FILES.
    const flat: Array<{ sessionId: string; index: number; entry: SessionFileEntry }> = [];
    for (const row of (sessionRows ?? []) as Array<{ id: string; files: unknown }>) {
      if (!Array.isArray(row.files)) continue;
      row.files.forEach((entry, index) => {
        if (flat.length < BATCH_MAX_FILES && isFileEntry(entry)) {
          flat.push({ sessionId: row.id, index, entry });
        }
      });
    }

    if (flat.length === 0) {
      return { files: [] };
    }

    const { data: signed, error: storageError } = await createSignedViewUrls(
      ctx,
      flat.map((f) => f.entry.path),
      BATCH_URL_TTL_SECONDS,
    );

    if (storageError || !signed) {
      throw new AppError('storage_unavailable', 503);
    }

    const files = flat.map((f, i) => ({
      sessionId: f.sessionId,
      fileIndex: f.index,
      signedUrl: signed[i]?.signedUrl ?? null,
      name: f.entry.name,
      mimeType: f.entry.mimeType,
      kind: f.entry.kind,
    }));

    return { files };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('server_error', 500);
  }
}
