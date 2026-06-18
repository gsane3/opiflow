// GET /api/folders/[id]/attention
//
// The single primary "Τι χρειάζεται τώρα" attention state for one work folder.
// Computed-only (no persistence, no migration). Business-scoped via
// authenticateBusinessRequest. Returns null for closed/not-found folders. The
// label/explanation are fixed Greek templates — no transcript or call-brief text,
// no internal IDs. The public /f/[token] portal is unaffected (separate loader).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { computeFolderAttentionForFolder } from '@/lib/server/folder-attention-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: folderId } = await params;

  try {
    const attention = await computeFolderAttentionForFolder(supabase, businessId, folderId);
    return NextResponse.json({ ok: true, attention });
  } catch {
    // Never break the folder view because of the attention engine.
    return NextResponse.json({ ok: true, attention: null });
  }
}
