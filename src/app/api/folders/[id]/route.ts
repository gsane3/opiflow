// GET / PATCH / DELETE /api/folders/[id] — one Έργο (work folder): detail,
// update (title / notes / status / step), delete.
//
// ADOPTED to the modular pattern (src/server/modules/folders): thin adapter. The
// folder-detail aggregation, the migration-047 double-select fallback, the
// migration-tolerant read-receipt merge, every validation code, the no-change
// "return current folder" path, the terminal-transition token cap, and the payment
// delete-guard all live in the service. Byte-identical.
//
// Service-role client bypasses RLS, so the folder is always scoped by business_id
// (a folder from another business resolves as not found → 404). Requires migration
// 046. Raw DB errors are never returned to the caller.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { getFolderDetail, patchFolder, removeFolder } from '@/server/modules/folders/folders.service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id: folderId } = await params;
    const result = await getFolderDetail(ctx, folderId);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  try {
    const { id: folderId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail('invalid_json', 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail('invalid_json', 400);
    }

    const result = await patchFolder(ctx, folderId, body as Record<string, unknown>);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id: folderId } = await params;
    await removeFolder(ctx, folderId);
    return ok();
  } catch (err) {
    return handleApiError(err);
  }
}
