// GET /api/folders/[id]/attention  → { ok, attention: ClientFolderAttention | null }
//
// ADOPTED to the modular pattern (src/server/modules/folder-actions): thin adapter.
// The single primary "Τι χρειάζεται τώρα" attention state is computed-only (no
// persistence, no migration). Tolerant: any compute throw → null so the attention
// engine never breaks the folder view. Returns null for closed/not-found folders.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { getFolderAttention } from '@/server/modules/folder-actions/folder-actions.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const { id: folderId } = await params;
  const attention = await getFolderAttention(ctx, folderId);
  return ok({ attention });
}
