// Service catalog item — update + (soft) delete (redesign P4).
//
// ADOPTED to the modular pattern (src/server/modules/catalog): thin adapter. The
// partial-update build, name validation, no_fields/duplicate_code/not_found mapping,
// and the soft-delete live in the service/repo. Responses are byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { updateCatalogItem, softDeleteCatalogItem } from '@/server/modules/catalog/catalog.service';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_json', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('invalid_json', 400);
  }

  try {
    const item = await updateCatalogItem(ctx, id, body as Record<string, unknown>);
    return ok({ item });
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
  const { id } = await params;
  try {
    await softDeleteCatalogItem(ctx, id);
    return ok({});
  } catch (err) {
    return handleApiError(err);
  }
}
