// GET   /api/folders/[id]/next-action  → { ok, action: ClientNextAction | null }
// PATCH /api/folders/[id]/next-action   → mark the active action accepted|dismissed|snooze|complete
//
// ADOPTED to the modular pattern (src/server/modules/folder-actions): thin adapter.
// The folder-level compute (tolerant of a pending migration 054 → null) and the
// lifecycle validation (invalid_body) live in the service; the PATCH returns the
// lib's boolean ok verbatim. Distinct from the customer-level next-action module.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { getFolderNextAction, applyFolderNextAction } from '@/server/modules/folder-actions/folder-actions.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const { id: folderId } = await params;
  const action = await getFolderNextAction(ctx, folderId);
  return ok({ action });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return fail('unsupported_content_type', 415);
  }

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  await params; // folderId not needed — the action id + business scope are authoritative.

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_body', 400);
  }
  if (typeof body !== 'object' || body === null) return fail('invalid_body', 400);

  try {
    const result = await applyFolderNextAction(ctx, body as Record<string, unknown>);
    return NextResponse.json({ ok: result });
  } catch (err) {
    return handleApiError(err);
  }
}
