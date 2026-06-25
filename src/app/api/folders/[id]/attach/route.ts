// POST /api/folders/[id]/attach — file an existing record into a folder, or
// remove it. Body: { entityType, entityId, attach }.
//
//   attach=true  → set work_folder_id = folder.id
//   attach=false → set work_folder_id = null
//
// ADOPTED to the modular pattern (src/server/modules/folders): thin adapter. The
// validation codes, the multi-table tenant/customer checks, customer_mismatch, and
// the attach_failed broad-catch live in the service. Byte-identical.
//
// Multi-tenant safety is enforced with EXPLICIT business_id / customer_id filters
// (never the DB FK alone), under the service-role client which bypasses RLS:
//   * cross-business entity → resolves as not found (404), never touched
//   * attaching another customer's record into this folder → 409 customer_mismatch
//
// Requires migration 046. Raw DB errors are never returned to the caller.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { attachEntity } from '@/server/modules/folders/folders.service';

export const runtime = 'nodejs';

export async function POST(
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

    const result = await attachEntity(ctx, folderId, body as Record<string, unknown>);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
