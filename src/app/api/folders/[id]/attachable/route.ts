// GET /api/folders/[id]/attachable — list UNFILED items that can be attached to
// this folder (WF-4). Returns the folder customer's offers + appointment-tasks +
// communications + intake/upload requests whose work_folder_id IS NULL, so the
// business can pick one to file in.
//
// ADOPTED to the modular pattern (src/server/modules/folders): thin adapter. The
// five parallel unfiled-pick reads, the per-section row mapping, and the
// attachable_failed broad-catch live in the service. Byte-identical.
//
// Business-scoped + customer-scoped (a folder from another business resolves as
// 404). Requires migration 046. Raw DB errors are never returned to the caller.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { listAttachable } from '@/server/modules/folders/folders.service';

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
    const result = await listAttachable(ctx, folderId);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
