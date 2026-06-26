// DELETE /api/scheduled-messages/[id]  → cancel a pending scheduled message.
//
// ADOPTED to the modular pattern (src/server/modules/scheduled-messages): thin
// adapter. The tenant-scoped cancel (no-op if already sent/cancelled or not found)
// lives in the service/repo. Response byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { cancelScheduledMessage } from '@/server/modules/scheduled-messages/scheduled-messages.service';

export const runtime = 'nodejs';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const { id } = await params;
  try {
    await cancelScheduledMessage(ctx, id);
    return ok({});
  } catch (err) {
    return handleApiError(err);
  }
}
