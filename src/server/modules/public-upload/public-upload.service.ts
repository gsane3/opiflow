// Public upload — service (explicit validation + orchestration). Parity-matched to
// the three PUBLIC token routes /api/upload/[token], /complete and /signed-url.
//
// The route stays a thin shell that does: rate-limit → (content-type guard) → token
// verify (findValidUploadToken) → parse → service → response-map. The token row is
// already verified and PASSED IN; the service runs the post-verify DB/business logic
// on the SERVICE-ROLE client (ctx.supabase) with the explicit business_id/customer_id
// from that token row — exactly as the original routes do.
//
// Bespoke response shapes (GET uses `reason`, signed-url/complete use `error`, and the
// GET 200 body is a custom { ok, maxFiles, … }) are rebuilt verbatim in the route via
// NextResponse.json; this service returns plain values / throws AppError so the route
// maps them. Effectful libs (hashUploadToken, mark*, Supabase Storage, push) stay thin:
// hashing/Storage live in the repo, the token-lifecycle marks and the push send stay in
// the route (push is injected here as a dep so tests never touch it).

import { AppError } from '../../core/errors';
import {
  ensureValidUploadFile,
  getUploadKind,
  hashUploadToken,
  ALLOWED_MIME_TYPES,
  MAX_FILES_PER_SESSION,
  MAX_FILE_SIZE_BYTES,
  type UploadTokenRow,
} from '../../../lib/server/upload-tokens';
import {
  createSignedUploadUrl,
  insertCommunication,
  insertUploadSession,
  selectTokenStatusByHash,
  type RepoContext,
  type SessionFileRecord,
} from './public-upload.repo';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// The upload link is delivered over viber/sms/email; reuse the delivery channel
// for the inbound row (default viber), matching the offer/appointment pattern.
function inboundChannel(sent: 'viber' | 'sms' | 'email' | 'manual' | null): 'viber' | 'sms' | 'email' {
  return sent === 'sms' || sent === 'email' ? sent : 'viber';
}

// ---------------------------------------------------------------------------
// GET /api/upload/[token]
// ---------------------------------------------------------------------------

/** The public config returned when the token is valid (GET 200 body, sans `ok`). */
export interface PublicUploadConfig {
  maxFiles: number;
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
}

export function publicUploadConfig(): PublicUploadConfig {
  return {
    maxFiles: MAX_FILES_PER_SESSION,
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
  };
}

/**
 * Resolves the GET 404 `reason` for a token that did not verify: 'completed' when a
 * row exists with status='completed', otherwise 'invalid'. Mirrors the original
 * service-client status lookup by token hash.
 */
export async function resolveNotFoundReason(
  ctx: RepoContext,
  rawToken: string,
): Promise<'completed' | 'invalid'> {
  const tokenHash = hashUploadToken(rawToken);
  const { data } = await selectTokenStatusByHash(ctx, tokenHash);
  return data && (data as { status: string }).status === 'completed' ? 'completed' : 'invalid';
}

// ---------------------------------------------------------------------------
// POST /api/upload/[token]/signed-url
// ---------------------------------------------------------------------------

export interface SignedUploadUrlResult {
  uploadUrl: string;
  uploadPath: string;
  token: string;
}

export async function mintSignedUploadUrl(
  ctx: RepoContext,
  tokenRow: UploadTokenRow,
  body: unknown,
): Promise<SignedUploadUrlResult> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('invalid_body', 400);
  }
  const raw = body as Record<string, unknown>;

  const filename = str(raw.filename);
  const mimeType = str(raw.mimeType);
  const sizeBytes = typeof raw.sizeBytes === 'number' ? raw.sizeBytes : null;

  if (!filename || !mimeType || sizeBytes === null) {
    throw new AppError('missing_fields', 400);
  }

  const validation = ensureValidUploadFile({ filename, mimeType, sizeBytes });
  if (!validation.valid) {
    throw new AppError(validation.error, 422);
  }

  const { data, error } = await createSignedUploadUrl(ctx, {
    businessId: tokenRow.business_id,
    customerId: tokenRow.customer_id,
    uploadTokenId: tokenRow.id,
    filename,
  });

  if (error || !data) {
    throw new AppError('storage_unavailable', 503);
  }

  return {
    uploadUrl: data.signedUrl,
    uploadPath: data.path,
    token: data.token,
  };
}

// ---------------------------------------------------------------------------
// POST /api/upload/[token]/complete
// ---------------------------------------------------------------------------

export interface CompleteUploadDeps {
  /** Notify the business owner of the customer's comment (fire-and-forget, awaited). */
  sendPush?: (
    businessId: string,
    payload: { title: string; body: string; url: string; data: Record<string, string> },
  ) => Promise<void>;
  /** Mark the token completed (non-fatal). Injected so the route owns token lifecycle. */
  markCompleted?: (tokenId: string) => Promise<void>;
}

export async function recordUpload(
  ctx: RepoContext,
  tokenRow: UploadTokenRow,
  body: unknown,
  deps: CompleteUploadDeps = {},
): Promise<{ ok: true }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('invalid_body', 400);
  }
  const raw = body as Record<string, unknown>;

  if (
    !Array.isArray(raw.files) ||
    raw.files.length === 0 ||
    raw.files.length > MAX_FILES_PER_SESSION
  ) {
    throw new AppError('invalid_files', 400);
  }

  const expectedPrefix = `${tokenRow.business_id}/${tokenRow.customer_id}/${tokenRow.id}/`;

  const files: SessionFileRecord[] = [];

  for (const f of raw.files as unknown[]) {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) {
      throw new AppError('invalid_file_entry', 400);
    }
    const fe = f as Record<string, unknown>;

    const uploadPath = str(fe.uploadPath);
    const name = str(fe.name);
    const mimeType = str(fe.mimeType);
    const sizeBytes = typeof fe.sizeBytes === 'number' ? fe.sizeBytes : null;

    if (!uploadPath || !name || !mimeType || sizeBytes === null) {
      throw new AppError('invalid_file_entry', 400);
    }

    if (!uploadPath.startsWith(expectedPrefix)) {
      throw new AppError('invalid_upload_path', 403);
    }

    const validation = ensureValidUploadFile({ filename: name, mimeType, sizeBytes });
    if (!validation.valid) {
      throw new AppError(validation.error, 422);
    }

    files.push({
      path: uploadPath,
      name,
      sizeBytes,
      mimeType,
      kind: getUploadKind(mimeType),
    });
  }

  const customerComment = str(raw.customerComment) ?? null;
  const now = new Date().toISOString();

  const { error: insertError } = await insertUploadSession(ctx, {
    businessId: tokenRow.business_id,
    customerId: tokenRow.customer_id,
    uploadTokenId: tokenRow.id,
    files,
    customerComment,
    now,
  });

  if (insertError) {
    throw new AppError('server_error', 500);
  }

  try {
    if (deps.markCompleted) await deps.markCompleted(tokenRow.id);
  } catch {
    // non-fatal: session is already recorded
  }

  // Surface the customer's free-text comment as an INBOUND message so it
  // threads into the customer timeline (same pattern as offer/appointment
  // -response). Best-effort & non-fatal — the upload is already recorded.
  if (customerComment) {
    const summary = `Σχόλιο από ανέβασμα φωτογραφιών: ${customerComment.slice(0, 1000)}`;
    try {
      await insertCommunication(ctx, {
        businessId: tokenRow.business_id,
        customerId: tokenRow.customer_id,
        channel: inboundChannel(tokenRow.sent_channel),
        summary,
      });
    } catch {
      // intentionally swallowed
    }
    if (deps.sendPush) {
      await deps.sendPush(tokenRow.business_id, {
        title: 'Νέο μήνυμα από πελάτη',
        body: summary,
        url: `/customers/${tokenRow.customer_id}`,
        data: { type: 'customer_message', source: 'upload' },
      });
    }
  }

  return { ok: true };
}
