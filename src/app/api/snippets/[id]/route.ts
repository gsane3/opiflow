// PATCH  /api/snippets/[id]  → edit { title?, body? }
// DELETE /api/snippets/[id]  → remove a snippet
//
// ADOPTED to the modular pattern (src/server/modules/snippets): thin adapter. The
// partial-update validation (invalid_title/invalid_body), not_found, and delete live
// in the service/repo. Responses are byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { updateSnippet, deleteSnippet } from '@/server/modules/snippets/snippets.service';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    const snippet = await updateSnippet(ctx, id, body as Record<string, unknown>);
    return ok({ snippet });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const { id } = await params;
  try {
    await deleteSnippet(ctx, id);
    return ok({});
  } catch (err) {
    return handleApiError(err);
  }
}
